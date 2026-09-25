import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../src/registry.ts';
import { ViewProjection } from '../src/view-projection.ts';
import { parseSupervisorView } from '../src/view-protocol.ts';
import type { Execution } from '../src/executions.ts';
import { FakeClock } from './helpers.ts';
import type { CompletionNotice } from '../src/notifications.ts';

function setup() {
  const clock = new FakeClock();
  const registry = new Registry(clock);
  const task = registry.register('ses_A');
  task.phase = 'dispatching'; registry.attach(task, 'ses_childA'); task.phase = 'active';
  registry.register('ses_B');
  const executions: Execution[] = [];
  const projection = new ViewProjection(registry, clock, { pluginVersion: '0.1.0', openCodeVersion: '1.18.29', isolationId: 'lab_A' }, () => executions);
  return { registry, clock, task, executions, projection };
}

test('bounded display titles cross the view boundary without exposing prompts or outputs', () => {
  const { task, projection } = setup();
  assert.equal(projection.snapshot('ses_A').tasks[0].title, null);
  task.title = 'Check R1 (@coder subagent)';
  task.result = { text: 'private output', messageId: 'msg_result', outcome: 'completed' };
  const view = projection.snapshot('ses_A');
  assert.equal(view.tasks[0].title, task.title);
  assert.ok(!JSON.stringify(view).includes('private output'));
  const legacy = { ...view.tasks[0] }; delete (legacy as Partial<typeof legacy>).title;
  assert.equal(parseSupervisorView({ ...view, tasks: [legacy] }).tasks[0].title, null);
  for (const title of ['x'.repeat(501), 'bad\nname', 123])
    assert.throws(() => parseSupervisorView({ ...view, tasks: [{ ...view.tasks[0], title }] }));
});

test('notification queue and activity waits are separate and elapsed time is not a revision', async () => {
  const { registry, clock, task } = setup();
  const notice: CompletionNotice = { ...task, childSessionId: task.childSessionId!, eventId: 'event_A',
    notificationId: 'notice_A', messageId: 'msg_notice', delivery: 'queued', progress: 'not_observed', createdAt: 0, baseline: new Set() };
  const projection = new ViewProjection(registry, clock, { pluginVersion: '0.1.0', openCodeVersion: '1.18.29', isolationId: 'lab_A' },
    undefined, () => [notice]);
  const initial = projection.snapshot('ses_A');
  await clock.advance(600_000);
  const queued = projection.snapshot('ses_A');
  assert.equal(queued.revision, initial.revision);
  assert.equal(queued.notifications[0]?.queueAgeMs, 600_000);
  assert.equal(queued.notifications[0]?.activityWaitAgeMs, null);
  notice.submittedAt = clock.now(); notice.delivery = 'submitted';
  const submitted = projection.snapshot('ses_A');
  await clock.advance(10_000);
  const waiting = projection.snapshot('ses_A');
  assert.equal(waiting.revision, submitted.revision);
  assert.equal(waiting.notifications[0]?.queueAgeMs, 600_000);
  assert.equal(waiting.notifications[0]?.activityWaitAgeMs, 10_000);
  notice.activityObservedAt = clock.now(); notice.progress = 'activity_observed';
  const active = projection.snapshot('ses_A');
  await clock.advance(30_000);
  assert.equal(projection.snapshot('ses_A').notifications[0]?.activityWaitAgeMs, 10_000);
  assert.equal(projection.snapshot('ses_A').revision, active.revision);
  assert.throws(() => parseSupervisorView({ ...active, notifications: [{ ...active.notifications[0], queueAgeMs: -1 }] }));
});

test('whitelisted projection scopes parent data and ages without inventing progress', async () => {
  const { task, clock, projection } = setup();
  task.reason = 'secret command';
  task.result = { text: 'secret output', messageId: 'msg_secret', outcome: 'completed' };
  const first = projection.snapshot('ses_A');
  assert.equal(first.tasks.length, 1);
  assert.equal(first.tasks[0]?.lastObservationAgeMs, null);
  assert.equal(JSON.stringify(first).includes('secret'), false);
  await clock.advance(600_000);
  const later = projection.snapshot('ses_A');
  assert.equal(later.revision, first.revision);
  assert.equal(later.tasks[0]?.lastProgressAgeMs, 600_000);
  task.lastCheckedAt = clock.now();
  const polled = projection.snapshot('ses_A');
  assert.ok(polled.revision > later.revision);
  assert.equal(polled.tasks[0]?.lastProgressAgeMs, 600_000);
  assert.equal(projection.snapshot('ses_B').tasks.some(t => t.taskId === task.taskId), false);
  assert.equal(projection.snapshot('ses_empty').tasks.length, 0);
  task.lastProgressAt = 0.123456789;
  const fractional = projection.snapshot('ses_A');
  await clock.advance(0.987654321);
  assert.equal(projection.snapshot('ses_A').revision, fractional.revision);
});

test('parser strips unknown fields, represents new state values as unknown, and rejects foreign ownership', () => {
  const { projection } = setup();
  const view = projection.snapshot('ses_A');
  const parsed = parseSupervisorView({ ...view, token: 'secret', tasks: [{ ...view.tasks[0], health: 'future_state', command: 'secret' }] });
  assert.equal(parsed.tasks[0]?.health, 'unknown');
  assert.equal(JSON.stringify(parsed).includes('secret'), false);
  assert.throws(() => parseSupervisorView({ ...view, schemaVersion: 2 }));
  assert.throws(() => parseSupervisorView({ ...view, openCodeVersion: 'malformed-version' }));
  assert.throws(() => parseSupervisorView({ ...view, observedAt: '2026-02-30T00:00:00.000Z' }));
  assert.throws(() => parseSupervisorView({ ...view, tasks: [...view.tasks, ...view.tasks] }));
  assert.throws(() => parseSupervisorView({ ...view, tasks: [{ ...view.tasks[0], parentSessionId: 'ses_B' }] }));
  assert.throws(() => parseSupervisorView({ ...view, tasks: [{ ...view.tasks[0], lastProgressAgeMs: -1 }] }));
});

test('old attempts are excluded and unknown cancellation never projects stopped or zero metrics', () => {
  const { task, executions, projection } = setup();
  executions.push({ taskId: task.taskId, attemptId: task.attemptId, parentSessionId: task.parentSessionId,
    childSessionId: task.childSessionId!, executionId: 'exec_A', toolCallId: 'call_A',
    phase: 'running', health: 'unknown', createdAt: 0, lastActivityAt: 0,
    artifactPaths: ['secret/path'], cancelRequested: true, cancelOutcomeUnknown: true, safeToRetry: false });
  const view = projection.snapshot('ses_A');
  assert.equal(view.executions[0]?.ownedProcessesStopped, null);
  assert.equal(view.executions[0]?.rootExited, null);
  assert.equal(view.executions[0]?.cpu100ns, null);
  assert.equal(view.executions[0]?.requestAccepted, null);
  assert.equal(view.executions[0]?.safeToRetry, false);
  assert.equal(JSON.stringify(view).includes('secret'), false);
  assert.throws(() => parseSupervisorView({ ...view, executions: [{ ...view.executions[0], ownedProcessesStopped: true }] }));
  assert.throws(() => parseSupervisorView({ ...view, executions: [{ ...view.executions[0], phase: 'stopped' }] }));
  assert.throws(() => parseSupervisorView({ ...view, executions: [{ ...view.executions[0], attemptId: 'foreign' }] }));
  executions[0]!.attemptId = 'old';
  assert.equal(projection.snapshot('ses_A').executions.length, 0);
});

test('historical notification identity survives a fresh empty task owner without implying task recovery', () => {
  const clock = new FakeClock(), registry = new Registry(clock);
  const identity = { schemaVersion: 1 as const, isolationId: 'lab_A', instanceId: 'previous_instance',
    taskId: 'previous_task', attemptId: 'previous_attempt', parentSessionId: 'ses_A', childSessionId: 'ses_childA',
    notificationId: 'notice_A', eventId: 'event_A', messageId: 'msg_A' };
  const projection = new ViewProjection(registry, clock, { pluginVersion: '0.1.0', openCodeVersion: '1.18.29', isolationId: 'lab_A' },
    undefined, undefined, undefined, parent => parent === 'ses_A' ? [identity] : []);
  const view = projection.snapshot('ses_A');
  assert.equal(view.tasks.length, 0);
  assert.equal(view.executions.length, 0);
  assert.notEqual(view.instanceId, identity.instanceId);
  assert.deepEqual(view.notificationIdentities, [identity]);
  assert.deepEqual(projection.snapshot('ses_B').notificationIdentities, []);
  assert.throws(() => parseSupervisorView({ ...view, notificationIdentities: [{ ...identity, isolationId: 'foreign' }] }));
  assert.throws(() => parseSupervisorView({ ...view, notificationIdentities: [{ ...identity, parentSessionId: 'ses_B' }] }));
});
