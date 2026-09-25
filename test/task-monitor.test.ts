import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Supervisor } from '../src/supervisor.ts';
import { Notifications } from '../src/notifications.ts';
import { FakeClock, FakeApi, snapshot, flush } from './helpers.ts';

async function setup(staleMs = 300_000) {
  const clock = new FakeClock(), api = new FakeApi(), owner = new Supervisor(api, clock, 500, staleMs);
  const task = owner.register('parent');
  owner.dispatch(task.taskId, 'parent', 'assignment', undefined, 'inline');
  await owner.settledDispatches();
  api.snapshots.set('child-1', snapshot('child-1', { activity: ['started'] }));
  return { clock, api, owner, taskId: task.taskId };
}

test('dispatch monitoring holds the tool open and returns child result without parent wakeup', async () => {
  const { clock, api, owner, taskId } = await setup();
  const notices = new Notifications(owner);
  let done = false;
  const waiting = owner.waitForDecision(taskId, 'parent').then(result => { done = true; return result; });
  await flush(); assert.equal(done, false);
  await clock.advance(1000); assert.equal(done, false);
  api.snapshots.set('child-1', snapshot('child-1', { status: 'idle', terminal: 'completed',
    result: { messageId: 'final', text: 'Child evidence', outcome: 'completed' } }));
  await clock.advance(1000);
  const result = await waiting;
  assert.equal(result.event, 'completed'); assert.equal(result.result?.text, 'Child evidence');
  await notices.tick(); assert.equal(notices.all().length, 0); assert.equal(api.notifications, 0);
  assert.equal(api.aborts, 0); assert.equal(api.dispatches, 1);
  assert.equal(clock.timers.length, 0);
});

test('a checkpoint preserves the original task and continuing a wait never redispatches', async () => {
  const { clock, api, owner, taskId } = await setup();
  const waiting = owner.waitForDecision(taskId, 'parent', 2000);
  await flush(); await clock.advance(2000);
  const checkpoint = await waiting;
  assert.equal(checkpoint.event, 'checkpoint'); assert.equal(checkpoint.phase, 'active');
  assert.equal(checkpoint.safeToRetry, false); assert.equal(checkpoint.lastProgressAgeMs, 2000);
  assert.match(checkpoint.next, /supervisor_wait/);
  const second = owner.waitForDecision(taskId, 'parent', 1000);
  await flush(); await clock.advance(1000); await second;
  assert.equal(api.dispatches, 1); assert.equal(api.creates, 1); assert.equal(api.notifications, 0);
});

test('suspected stall returns once immediately, repeated waits are held until the next checkpoint', async () => {
  const { clock, api, owner, taskId } = await setup(1500);
  const first = owner.waitForDecision(taskId, 'parent', 10000);
  await flush(); await clock.advance(1000); await clock.advance(1000);
  assert.equal((await first).health, 'suspected_stall');
  let done = false;
  const second = owner.waitForDecision(taskId, 'parent', 5000).then(value => { done = true; return value; });
  await flush(); assert.equal(done, false);
  await clock.advance(1000); assert.equal(done, false);
  await clock.advance(4000); assert.equal((await second).event, 'attention');
  assert.equal(api.aborts, 0); assert.equal(api.dispatches, 1);
});

test('a new permission alert and observation failure return actionable state, not completion', async () => {
  for (const kind of ['permission', 'unreachable']) {
    const { api, owner, taskId } = await setup();
    if (kind === 'permission') api.snapshots.set('child-1', snapshot('child-1', { permissionIds: ['perm'] }));
    else api.snapshots.delete('child-1');
    const result = await owner.waitForDecision(taskId, 'parent');
    assert.equal(result.event, 'attention'); assert.equal(result.result, null);
    assert.equal(result.health, kind === 'permission' ? 'waiting_permission' : 'unreachable');
    assert.equal(api.aborts, 0);
  }
});

test('interruption releases only the wait; it does not claim completion or kill the child', async () => {
  const { clock, api, owner, taskId } = await setup();
  const controller = new AbortController();
  const waiting = owner.waitForDecision(taskId, 'parent', 60000, controller.signal);
  await flush(); controller.abort(new Error('parent interrupted'));
  await assert.rejects(waiting, /parent interrupted/);
  assert.equal(owner.status(taskId, 'parent').phase, 'active'); assert.equal(api.aborts, 0);
  assert.equal(clock.timers.length, 0);
  await assert.rejects(owner.waitForDecision(taskId, 'foreign'), /not owned/);
});

test('explicit cancellation is idempotent, parent scoped and never certifies process termination', async () => {
  const { api, owner, taskId } = await setup();
  await assert.rejects(owner.cancel(taskId, 'foreign'), /not owned/);
  const result = await owner.cancel(taskId, 'parent');
  assert.equal(result.requestAccepted, true); assert.equal(result.cancellation, 'acknowledged');
  assert.equal(result.ownedProcessesStopped, null); assert.equal(result.safeToRetry, false);
  await owner.cancel(taskId, 'parent'); assert.equal(api.aborts, 1);
  assert.throws(() => owner.dispatch(taskId, 'parent', 'retry'), /cannot be dispatched/);
  assert.equal(api.dispatches, 1);
});

test('cancellation during child creation fences prompt submission before aborting', async () => {
  const clock = new FakeClock(), api = new FakeApi(), owner = new Supervisor(api, clock);
  let create!: (id: string) => void;
  api.create = () => new Promise(resolve => { create = resolve; });
  const { taskId } = owner.register('parent');
  owner.dispatch(taskId, 'parent', 'assignment', undefined, 'inline');
  const cancelled = owner.cancel(taskId, 'parent');
  create('child-1'); await flush();
  assert.equal((await cancelled).requestAccepted, true);
  assert.equal(api.dispatches, 0); assert.equal(api.aborts, 1);
});

test('failed cancellation remains unknown and is never blindly resubmitted', async () => {
  const { api, owner, taskId } = await setup();
  api.abort = async () => { api.aborts++; throw new Error('transport failed'); };
  assert.equal((await owner.cancel(taskId, 'parent')).cancellation, 'unknown');
  assert.equal((await owner.cancel(taskId, 'parent')).safeToRetry, false);
  assert.equal(api.aborts, 1);
});

test('terminal failure is returned as evidence and stays terminal on repeated waits', async () => {
  const { api, owner, taskId } = await setup();
  api.snapshots.set('child-1', snapshot('child-1', { status: 'idle', terminal: 'failed',
    result: { messageId: 'error', text: '', outcome: 'failed', error: 'ProviderError' } }));
  assert.equal((await owner.waitForDecision(taskId, 'parent')).outcome, 'failed');
  api.snapshots.set('child-1', snapshot('child-1'));
  assert.equal((await owner.waitForDecision(taskId, 'parent')).outcome, 'failed');
  assert.equal((await owner.cancel(taskId, 'parent')).requestAccepted, false); assert.equal(api.aborts, 0);
});
