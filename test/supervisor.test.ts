import test from 'node:test';
import assert from 'node:assert/strict';
import { Supervisor } from '../src/supervisor.ts';
import { RecoveryLab } from '../src/recovery-lab.ts';
import { FakeApi, FakeClock, snapshot, flush } from './helpers.ts';

async function setup() {
  const clock = new FakeClock(), api = new FakeApi(), supervisor = new Supervisor(api, clock, 100, 1000);
  const task = supervisor.register('parent');
  supervisor.dispatch(task.taskId, 'parent', 'task');
  await supervisor.settledDispatches();
  return { clock, api, supervisor, taskId: task.taskId, child: 'child-1' };
}

test('dispatch returns immediately; duplicate dispatch never starts another attempt', async () => {
  const { api, supervisor, taskId } = await setup();
  supervisor.dispatch(taskId, 'parent', 'duplicate');
  assert.equal(api.creates, 1); assert.equal(api.dispatches, 1);
  assert.equal(supervisor.status(taskId, 'parent').phase, 'active');
});
test('normal completion terminal is monotonic and late running data is ignored', async () => {
  const { api, supervisor, taskId, child } = await setup();
  api.snapshots.set(child, snapshot(child, { status: 'idle', terminal: 'completed', activity: ['final'] }));
  await supervisor.observe(taskId, 'parent');
  const task = supervisor.registry.get(taskId, 'parent');
  supervisor.registry.apply(task, snapshot(child, { activity: ['late'] }));
  assert.equal(task.phase, 'terminal'); assert.equal(task.outcome, 'completed');
});
test('polling success and duplicate activity do not refresh progress', async () => {
  const { api, clock, supervisor, taskId, child } = await setup();
  api.snapshots.set(child, snapshot(child, { activity: ['one'] }));
  await supervisor.observe(taskId, 'parent'); await clock.advance(1001);
  await supervisor.observe(taskId, 'parent');
  assert.equal(supervisor.status(taskId, 'parent').lastProgressAt, 0);
  assert.equal(supervisor.status(taskId, 'parent').health, 'suspected_stall');
  api.snapshots.set(child, snapshot(child, { activity: ['one', 'two'] }));
  await supervisor.observe(taskId, 'parent');
  assert.equal(supervisor.status(taskId, 'parent').lastProgressAt, 1001);
});
test('long silent computation with attributable process activity stays running', async () => {
  const { api, clock, supervisor, taskId, child } = await setup();
  await clock.advance(3_600_000);
  api.snapshots.set(child, snapshot(child, { process: 'active', processActivity: 'owned-pid-start:cpu-2' }));
  await supervisor.observe(taskId, 'parent');
  assert.equal(supervisor.status(taskId, 'parent').health, 'running');
  assert.equal(api.aborts, 0); assert.equal(api.dispatches, 1);
});
test('residual tool records prevent false completion', async () => {
  const { api, clock, supervisor, taskId, child } = await setup();
  await clock.advance(1001);
  api.snapshots.set(child, snapshot(child, { status: 'idle', pendingTools: 1, terminal: 'completed' }));
  await supervisor.observe(taskId, 'parent');
  assert.equal(supervisor.status(taskId, 'parent').health, 'suspected_stall');
  assert.equal(supervisor.status(taskId, 'parent').phase, 'active');
});
test('permission waiting takes precedence over inactivity', async () => {
  const { api, clock, supervisor, taskId, child } = await setup();
  await clock.advance(1_000_000);
  api.snapshots.set(child, snapshot(child, { permissionIds: ['permission-1'] }));
  await supervisor.observe(taskId, 'parent');
  assert.equal(supervisor.status(taskId, 'parent').health, 'waiting_permission');
});
test('query failure means unreachable, not ended; subsequent observation can recover', async () => {
  const { api, supervisor, taskId, child } = await setup();
  await supervisor.observe(taskId, 'parent');
  assert.equal(supervisor.status(taskId, 'parent').health, 'unreachable');
  api.snapshots.set(child, snapshot(child)); await supervisor.observe(taskId, 'parent');
  assert.equal(supervisor.status(taskId, 'parent').health, 'running');
});
test('hanging query bounded; late completion cannot mutate state', async () => {
  const { api, clock, supervisor, taskId, child } = await setup();
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  api.observe = () => new Promise(r => { resolve = r; });
  const operation = supervisor.observe(taskId, 'parent');
  await clock.advance(101); await operation;
  resolve(snapshot(child, { status: 'idle', terminal: 'completed' })); await flush();
  assert.equal(supervisor.status(taskId, 'parent').health, 'unreachable');
  assert.equal(supervisor.status(taskId, 'parent').phase, 'active');
});
test('dispatch timeout never retries and late create remains unknown', async () => {
  const clock = new FakeClock(), api = new FakeApi(), supervisor = new Supervisor(api, clock, 100);
  let resolve!: (id: string) => void;
  api.create = () => new Promise(r => { resolve = r; });
  const task = supervisor.register('parent'); supervisor.dispatch(task.taskId, 'parent', 'task');
  await clock.advance(101); await supervisor.settledDispatches();
  resolve('late-child'); await flush();
  assert.equal(supervisor.status(task.taskId, 'parent').dispatch, 'unknown');
  assert.equal(supervisor.status(task.taskId, 'parent').childSessionId, undefined);
  assert.equal(api.dispatches, 0);
});
test('attempt and child identity fences reject stale events', async () => {
  const { supervisor, taskId, child } = await setup();
  const task = supervisor.registry.get(taskId, 'parent');
  supervisor.registry.apply({ ...task, attemptId: 'old' }, snapshot(child, { terminal: 'completed', status: 'idle' }));
  supervisor.registry.apply(task, snapshot('foreign', { terminal: 'completed', status: 'idle' }));
  assert.equal(task.phase, 'active');
});
test('multiple parent and child sessions remain isolated', async () => {
  const { supervisor, api, taskId } = await setup();
  const other = supervisor.register('parent-2'); supervisor.dispatch(other.taskId, 'parent-2', 'other');
  await supervisor.settledDispatches();
  assert.throws(() => supervisor.status(taskId, 'parent-2'), /owned/);
  api.snapshots.set('child-1', snapshot('child-1', { permissionIds: ['p'] }));
  api.snapshots.set('child-2', snapshot('child-2', { status: 'idle', terminal: 'completed' }));
  await supervisor.tick();
  assert.equal(supervisor.status(taskId, 'parent').health, 'waiting_permission');
  assert.equal(supervisor.status(other.taskId, 'parent-2').outcome, 'completed');
});
test('wait clamps to 2 seconds even when existing query is hung', async () => {
  const { api, supervisor, clock, taskId } = await setup();
  api.observe = () => new Promise(() => {});
  const pending = supervisor.wait(taskId, 'parent', 999_999);
  await clock.advance(2001); const view = await pending;
  assert.notEqual(view.phase, 'terminal');
  await assert.rejects(supervisor.wait(taskId, 'parent', Infinity));
});
test('cancel refusal outside lab; success still means unknown process stop', async () => {
  const { supervisor, taskId, child, api } = await setup();
  await assert.rejects(new RecoveryLab(supervisor, new Set()).cancel(taskId, 'parent'));
  const lab = new RecoveryLab(supervisor, new Set(['parent', child]));
  await lab.cancel(taskId, 'parent'); await lab.cancel(taskId, 'parent');
  assert.equal(api.aborts, 1);
  assert.equal(supervisor.status(taskId, 'parent').cancellation, 'acknowledged');
  assert.equal(supervisor.status(taskId, 'parent').health, 'cancel_unknown');
});
test('cancel failure, timeout and late success never certify stopped', async () => {
  for (const mode of ['failure', 'timeout']) {
    const { supervisor, taskId, child, api, clock } = await setup();
    let resolve!: () => void;
    api.abort = mode === 'failure' ? async () => { throw new Error('failed'); } : () => new Promise(r => { resolve = r; });
    const lab = new RecoveryLab(supervisor, new Set(['parent', child]));
    const pending = lab.cancel(taskId, 'parent');
    await clock.advance(101); await pending;
    if (resolve) { resolve(); await flush(); }
    assert.equal(supervisor.status(taskId, 'parent').cancellation, 'unknown');
    api.snapshots.set(child, snapshot(child, { status: 'idle', terminal: 'completed' }));
    await supervisor.observe(taskId, 'parent');
    assert.equal(supervisor.status(taskId, 'parent').health, 'cancel_unknown');
  }
});
test('duplicate notifications and busy parent do not send twice', async () => {
  const { supervisor, taskId, child, api } = await setup();
  const lab = new RecoveryLab(supervisor, new Set(['parent', child]));
  const notice = lab.enqueue(taskId, 'parent'); assert.equal(lab.enqueue(taskId, 'parent'), notice);
  api.snapshots.set('parent', snapshot('parent')); await lab.check(notice);
  assert.equal(api.notifications, 0);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle' }));
  await Promise.all([lab.check(notice), lab.check(notice)]); await lab.check(notice);
  assert.equal(api.notifications, 1); assert.equal(notice.state, 'submitted');
});
test('submitted notice without parent progress escalates; submission is not recovery', async () => {
  const { supervisor, taskId, child, api, clock } = await setup();
  const lab = new RecoveryLab(supervisor, new Set(['parent', child]), 1000);
  api.snapshots.set('parent', snapshot('parent', { status: 'idle', assistantActivity: ['old'] }));
  const notice = lab.enqueue(taskId, 'parent'); await lab.check(notice);
  await clock.advance(1001); await lab.check(notice);
  assert.equal(notice.state, 'escalated'); assert.equal(api.notifications, 1);
});
test('only new assistant or tool evidence establishes observable parent progress', async () => {
  const { supervisor, taskId, child, api } = await setup();
  const lab = new RecoveryLab(supervisor, new Set(['parent', child]));
  api.snapshots.set('parent', snapshot('parent', { status: 'idle', assistantActivity: ['old'] }));
  const notice = lab.enqueue(taskId, 'parent'); await lab.check(notice);
  api.snapshots.set('parent', snapshot('parent', { activity: ['notification'] })); await lab.check(notice);
  assert.equal(notice.state, 'submitted');
  api.snapshots.set('parent', snapshot('parent', { assistantActivity: ['old', 'new'] })); await lab.check(notice);
  assert.equal(notice.state, 'progress_observed');
});
test('terminal observation survives a later dispatch response failure', async () => {
  const clock = new FakeClock(), api = new FakeApi(), supervisor = new Supervisor(api, clock, 100);
  let reject!: (reason: Error) => void;
  api.dispatch = () => new Promise((_, r) => { reject = r; });
  const task = supervisor.register('parent'); supervisor.dispatch(task.taskId, 'parent', 'task');
  await flush();
  api.snapshots.set('child-1', snapshot('child-1', { status: 'idle', terminal: 'completed' }));
  await supervisor.observe(task.taskId, 'parent');
  reject(new Error('response lost')); await supervisor.settledDispatches();
  assert.equal(supervisor.status(task.taskId, 'parent').health, 'ended');
});
test('notification timeout is unknown and never automatically resubmitted', async () => {
  const { supervisor, taskId, child, api, clock } = await setup();
  let deliveries = 0, resolve!: () => void;
  api.notify = () => { deliveries++; return new Promise(r => { resolve = r; }); };
  api.snapshots.set('parent', snapshot('parent', { status: 'idle' }));
  const lab = new RecoveryLab(supervisor, new Set(['parent', child]), 1000);
  const notice = lab.enqueue(taskId, 'parent'); const pending = lab.check(notice);
  await flush(); await clock.advance(101); await pending;
  assert.equal(notice.state, 'unknown'); resolve(); await flush(); await lab.check(notice);
  assert.equal(notice.state, 'unknown'); assert.equal(deliveries, 1);
});
test('continuously busy parent escalates without sending', async () => {
  const { supervisor, taskId, child, api, clock } = await setup();
  const lab = new RecoveryLab(supervisor, new Set(['parent', child]), 1000);
  api.snapshots.set('parent', snapshot('parent'));
  const notice = lab.enqueue(taskId, 'parent'); await lab.check(notice);
  await clock.advance(1001); await lab.check(notice);
  assert.equal(notice.state, 'escalated'); assert.equal(api.notifications, 0);
});
