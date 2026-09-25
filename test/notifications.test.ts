import test from 'node:test';
import assert from 'node:assert/strict';
import { Notifications, noticeReport } from '../src/notifications.ts';
import { Supervisor } from '../src/supervisor.ts';
import { FakeApi, FakeClock, snapshot, flush } from './helpers.ts';
import type { Execution } from '../src/executions.ts';

async function setup(outcome: 'completed' | 'failed' = 'completed') {
  const api = new FakeApi(), clock = new FakeClock(), supervisor = new Supervisor(api, clock, 100);
  const task = supervisor.register('parent'); supervisor.dispatch(task.taskId, 'parent', 'work');
  await supervisor.settledDispatches();
  api.snapshots.set('child-1', snapshot('child-1', { status: 'idle', terminal: outcome,
    result: { messageId: 'msg_final', text: outcome === 'completed' ? '37' : '', outcome, ...(outcome === 'failed' ? { error: 'TestError' } : {}) } }));
  await supervisor.observe(task.taskId, 'parent');
  api.snapshots.set('parent', snapshot('parent', { status: 'idle', messageIds: [] }));
  const notifications = new Notifications(supervisor, 1000, 10);
  const notice = notifications.enqueue(task.taskId, 'parent')!;
  return { api, clock, supervisor, notifications, notice, taskId: task.taskId };
}

test('first observed parent activity time is distinct from submission and never advances on polling', async () => {
  const { api, clock, notifications, notice } = await setup();
  await notifications.check(notice); await clock.advance(10); await notifications.check(notice);
  assert.equal(notice.submittedAt, 10);
  assert.equal(notice.activityObservedAt, undefined);
  api.snapshots.set('parent', snapshot('parent', { status: 'busy', messageIds: [notice.messageId] }));
  await clock.advance(10); await notifications.check(notice);
  assert.equal(notice.activityObservedAt, undefined);
  api.snapshots.set('parent', snapshot('parent', { status: 'busy', messageIds: [notice.messageId], assistantActivity: ['real-output'] }));
  await clock.advance(10); await notifications.check(notice);
  assert.equal(notice.activityObservedAt, 30);
  await clock.advance(100); await notifications.check(notice);
  assert.equal(notice.activityObservedAt, 30);
});

test('persistence gate precedes submission; failure and late success never send a prompt', async () => {
  const { supervisor, api, clock, taskId } = await setup();
  let calls = 0;
  const notices = new Notifications(supervisor, 1000, 0, async notice => {
    assert.ok(notice.messageId.startsWith('msg_'));
    assert.equal(api.notifications, 0);
    calls++;
    throw new Error('unavailable identity storage');
  });
  const notice = notices.enqueue(taskId, 'parent')!;
  await notices.check(notice);
  assert.equal(api.notifications, 0);
  assert.ok(notice.escalated);
  await notices.check(notice);
  assert.equal(calls, 1);
  let release!: () => void;
  const late = new Notifications(supervisor, 1000, 0, () => new Promise(resolve => { release = resolve; }));
  const lateNotice = late.enqueue(taskId, 'parent')!;
  const checking = late.check(lateNotice);
  await flush(); await clock.advance(101); await checking;
  release(); await flush();
  assert.equal(api.notifications, 0);
  assert.ok(lateNotice.escalated);
});

test('parent becoming busy during persistence defers using the same notification message identity', async () => {
  const { supervisor, api, taskId } = await setup();
  const ids: string[] = [];
  const notices = new Notifications(supervisor, 1000, 0, async notice => {
    ids.push(notice.messageId);
    if (ids.length === 1) api.snapshots.set('parent', snapshot('parent', { status: 'busy' }));
  });
  const notice = notices.enqueue(taskId, 'parent')!;
  await notices.check(notice);
  assert.equal(api.notifications, 0);
  assert.equal(notice.escalated, undefined);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle' }));
  await notices.check(notice);
  assert.equal(api.notifications, 1);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test('managed stop notices require complete evidence, defer while busy, dedupe and escalate without result read', async () => {
  const api = new FakeApi(), clock = new FakeClock(), supervisor = new Supervisor(api, clock, 100);
  const task = supervisor.register('parent'); supervisor.dispatch(task.taskId, 'parent', 'work'); await supervisor.settledDispatches();
  const execution = { ...task, childSessionId: 'child-1', executionId: 'execution', toolCallId: 'call',
    phase: 'stopped', health: 'stopped', createdAt: 0, lastActivityAt: 0, cancelRequested: true,
    cancelOutcomeUnknown: false, artifactPaths: [], safeToRetry: false,
    sample: { ownedProcessesStopped: true, rootExited: true, coverageUnknown: false } } as unknown as Execution;
  const notifications = new Notifications(supervisor, 1000, 10);
  assert.equal(notifications.enqueueCancellation({ ...execution, cancelOutcomeUnknown: true }), undefined);
  const notice = notifications.enqueueCancellation(execution)!;
  assert.equal(notifications.enqueueCancellation(execution), notice);
  api.snapshots.set('parent', snapshot('parent')); await notifications.check(notice); assert.equal(api.notifications, 0);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle' }));
  await notifications.check(notice); await clock.advance(11); await notifications.check(notice); assert.equal(api.notifications, 1);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle', messageIds: [notice.messageId], assistantActivity: ['received-only'] }));
  await notifications.check(notice); assert.equal(notice.progress, 'activity_observed');
  await clock.advance(1001); await notifications.check(notice); assert.ok(notice.escalated); assert.equal(api.notifications, 1);
});
test('completion event deduplication, result isolation, and distinct receipt/activity/read evidence', async () => {
  const { notifications, notice, api, clock, supervisor, taskId } = await setup();
  assert.equal(notifications.enqueue(taskId, 'parent'), notice);
  await notifications.check(notice); await clock.advance(11); await notifications.check(notice);
  assert.equal(notice.delivery, 'submitted'); assert.equal(notice.progress, 'not_observed');
  api.snapshots.set('parent', snapshot('parent', { status: 'idle', messageIds: [notice.messageId], assistantActivity: ['new'] }));
  await notifications.check(notice);
  assert.equal(notice.delivery, 'received'); assert.equal(notice.progress, 'activity_observed');
  assert.throws(() => supervisor.result(taskId, 'foreign'));
  assert.equal(supervisor.result(taskId, 'parent').result?.text, '37');
  notifications.readResult(taskId, 'parent', 'msg_parent_followup', notice.notificationId);
  assert.equal(notice.progress, 'result_read');
  assert.equal(noticeReport(notice).closedLoop, 'not_verified_by_supervisor');
  await notifications.tick(); assert.equal(api.notifications, 1);
});
test('busy parent and idle-to-busy race defer without losing or duplicating notification', async () => {
  const { notifications, notice, api, clock } = await setup();
  api.snapshots.set('parent', snapshot('parent')); await notifications.check(notice);
  assert.equal(api.notifications, 0);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle' }));
  await notifications.check(notice); await clock.advance(11);
  let calls = 0;
  api.observe = async id => snapshot(id, { status: ++calls === 1 ? 'idle' : 'busy' });
  await notifications.check(notice); assert.equal(api.notifications, 0);
  api.observe = async id => snapshot(id, { status: 'idle' });
  await notifications.check(notice); await clock.advance(11);
  await Promise.all([notifications.check(notice), notifications.check(notice)]);
  assert.equal(api.notifications, 1);
});
test('failed child exposes explicit failure result and gets a completion notice', async () => {
  const { notifications, notice, clock, supervisor, taskId } = await setup('failed');
  await notifications.check(notice); await clock.advance(11); await notifications.check(notice);
  assert.equal(notice.delivery, 'submitted');
  assert.equal(supervisor.result(taskId, 'parent').result?.error, 'TestError');
});
test('permission waiting is not completion and never auto-approved', async () => {
  const api = new FakeApi(), clock = new FakeClock(), supervisor = new Supervisor(api, clock);
  const task = supervisor.register('parent'); supervisor.dispatch(task.taskId, 'parent', 'work'); await supervisor.settledDispatches();
  api.snapshots.set('child-1', snapshot('child-1', { permissionIds: ['permission'] }));
  await supervisor.observe(task.taskId, 'parent');
  assert.equal(new Notifications(supervisor).enqueue(task.taskId, 'parent'), undefined);
  assert.equal(supervisor.status(task.taskId, 'parent').health, 'waiting_permission');
  assert.equal(api.notifications + api.aborts, 0);
});
test('arbitrary parent activity without result read still escalates', async () => {
  const { notifications, notice, api, clock } = await setup();
  await notifications.check(notice); await clock.advance(11); await notifications.check(notice);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle', messageIds: [notice.messageId], assistantActivity: ['unrelated text'] }));
  await notifications.check(notice); await clock.advance(1001); await notifications.check(notice);
  assert.match(notice.escalated!, /did not read/); assert.equal(api.notifications, 1);
});
test('submission timeout and late response stay unknown without resend; receipt may later resolve delivery', async () => {
  const { notifications, notice, api, clock } = await setup();
  let resolve!: () => void, sends = 0;
  api.notify = () => { sends++; return new Promise(r => { resolve = r; }); };
  await notifications.check(notice); await clock.advance(11);
  const pending = notifications.check(notice); await flush(); await clock.advance(101); await pending;
  assert.equal(notice.delivery, 'unknown'); resolve(); await flush(); await notifications.check(notice);
  assert.equal(notice.delivery, 'unknown'); assert.equal(sends, 1);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle', messageIds: [notice.messageId] }));
  await notifications.check(notice); assert.equal(notice.delivery, 'received');
});
test('query failures reach bounded escalation without sending a notification', async () => {
  const { notifications, notice, api, clock } = await setup();
  api.observe = async () => { throw new Error('query unavailable'); };
  await notifications.check(notice); await clock.advance(1001); await notifications.check(notice);
  assert.ok(notice.escalated); assert.equal(api.notifications, 0);
});
test('wrong notification identity cannot establish result consumption', async () => {
  const { notifications, notice, clock, taskId } = await setup();
  await notifications.check(notice); await clock.advance(11); await notifications.check(notice);
  notifications.readResult(taskId, 'parent', 'msg_other', 'different-notification');
  assert.equal(notice.progress, 'not_observed');
});
test('early session.error becomes explicit failure only after idle evidence, and cannot revive terminal', async () => {
  const api = new FakeApi(), clock = new FakeClock(), supervisor = new Supervisor(api, clock);
  const task = supervisor.register('parent'); supervisor.dispatch(task.taskId, 'parent', 'work'); await supervisor.settledDispatches();
  supervisor.recordSessionError('foreign', 'event_other', 'Error');
  supervisor.recordSessionError('child-1', 'event_failure', 'ModelError');
  api.snapshots.set('child-1', snapshot('child-1')); await supervisor.observe(task.taskId, 'parent');
  assert.equal(supervisor.status(task.taskId, 'parent').phase, 'active');
  api.snapshots.set('child-1', snapshot('child-1', { status: 'idle' })); await supervisor.observe(task.taskId, 'parent');
  assert.equal(supervisor.result(task.taskId, 'parent').result?.sourceEventId, 'event_failure');
  assert.equal(supervisor.result(task.taskId, 'parent').result?.messageId, '');
  supervisor.recordSessionError('child-1', 'late', 'LateError');
  assert.equal(supervisor.result(task.taskId, 'parent').result?.error, 'ModelError');
});
test('two parents have distinct completion events, notifications and result consumption', async () => {
  const { api, clock, supervisor, notifications, notice } = await setup();
  const other = supervisor.register('parent-2'); supervisor.dispatch(other.taskId, 'parent-2', 'other'); await supervisor.settledDispatches();
  api.snapshots.set('child-2', snapshot('child-2', { status: 'idle', terminal: 'completed',
    result: { messageId: 'msg_other', text: 'different', outcome: 'completed' } }));
  api.snapshots.set('parent-2', snapshot('parent-2', { status: 'idle' }));
  await supervisor.observe(other.taskId, 'parent-2');
  const second = notifications.enqueue(other.taskId, 'parent-2')!;
  assert.notEqual(notice.eventId, second.eventId); assert.notEqual(notice.notificationId, second.notificationId);
  await notifications.tick(); await clock.advance(11); await notifications.tick();
  assert.equal(api.notifications, 2);
  assert.throws(() => notifications.readResult(other.taskId, 'parent', 'msg', second.notificationId));
});
