import test from 'node:test';
import assert from 'node:assert/strict';
import { Executions } from '../src/executions.ts';
import { Registry } from '../src/registry.ts';
import type { JobSample, JobTransport } from '../src/job-client.ts';
import { FakeClock, flush } from './helpers.ts';

function setup() {
  const clock = new FakeClock(), registry = new Registry(clock);
  const task = registry.register('parent'); task.phase = 'dispatching'; registry.attach(task, 'child'); task.phase = 'active';
  let sequence = 0, launched = 0, cancellations = 0;
  let override: Partial<JobSample> = {}, failure = false;
  let delayed: (() => Promise<JobSample>) | undefined;
  let executionId = '';
  const sample = (): JobSample => ({ executionId, sequence: ++sequence, observedAt: new Date(0).toISOString(),
    rootPid: 12, rootCreationFileTime: '123', rootExited: false, exitCode: null, activeProcesses: 1, members: [],
    cpu100ns: '0', readBytes: '0', writeBytes: '0', requestAccepted: false, ownedProcessesStopped: false,
    coverageUnknown: false, cancelOutcomeUnknown: false,
    stdout: { text: '', totalBytes: 0, retainedBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, retainedBytes: 0, truncated: false }, scope: 'lab', ...override });
  const transport: JobTransport = { async call(op) {
    if (op === 'cancel') cancellations++;
    if (delayed) return delayed();
    if (failure) throw Error('access denied');
    return sample();
  }, async close() { return true; } };
  const executions = new Executions(registry, clock, id => { executionId = id; launched++; return transport; }, 100);
  const start = (permission = async () => {}) => executions.start('child', 'call-1', { executable: 'fixture', args: [], cwd: 'lab', artifactPaths: [] }, permission);
  return { clock, registry, task, executions, start, sample, set: (v: Partial<JobSample>) => { override = v; },
    fail: () => { failure = true; }, delay: (fn: () => Promise<JobSample>) => { delayed = fn; },
    launched: () => launched, cancellations: () => cancellations };
}
test('permission waiting/denial never launches a process; permission timeout does not later launch', async () => {
  const x = setup(); let allow!: () => void;
  const pending = x.start(() => new Promise<void>(r => { allow = r; })); await flush();
  assert.equal(x.executions.all()[0]!.phase, 'waiting_permission'); assert.equal(x.launched(), 0);
  await x.clock.advance(30000); assert.equal((await pending).phase, 'permission_denied');
  allow(); await flush(); assert.equal(x.launched(), 0);
});

test('cancelling a task while permission is pending fences the later launch', async () => {
  const x = setup(); let allow!: () => void;
  const waiting = x.start(() => new Promise<void>(r => { allow = r; })); await flush();
  x.task.cancellation = 'requested'; allow();
  assert.equal((await waiting).phase, 'start_failed'); assert.equal(x.launched(), 0);
  await assert.rejects(x.start(), /cannot launch/);
});
test('successful polling is not activity; quiet sleep becomes suspect without cancelling', async () => {
  const x = setup(), e = await x.start(); await x.clock.advance(101);
  const quiet = await x.executions.observe(e.executionId, 'parent');
  assert.equal(quiet.lastActivityAt, 0); assert.equal(quiet.health, 'suspect'); assert.equal(x.cancellations(), 0);
  x.set({ cpu100ns: '100' }); const active = await x.executions.observe(e.executionId, 'child');
  assert.equal(active.cpuDelta100ns, '100'); assert.equal(active.health, 'running');
});
test('PID creation-time mismatch and query denial produce unknown, never stop or safeToRetry', async () => {
  const x = setup(), e = await x.start(); x.set({ rootCreationFileTime: '999', rootExited: true, activeProcesses: 0, ownedProcessesStopped: true });
  const mismatch = await x.executions.observe(e.executionId, 'parent'); assert.equal(mismatch.health, 'unknown'); assert.equal(mismatch.safeToRetry, false);
  assert.equal(mismatch.sample!.rootCreationFileTime, '123'); x.fail(); assert.equal((await x.executions.observe(e.executionId, 'parent')).health, 'unknown');
});
test('cancellation timeout and late success do not certify stop or resend', async () => {
  const x = setup(), e = await x.start(); let finish!: (s: JobSample) => void;
  x.delay(() => new Promise(r => { finish = r; })); const cancel = x.executions.cancel(e.executionId, 'parent');
  await x.clock.advance(5001); const result = await cancel; assert.equal(result.cancelOutcomeUnknown, true);
  x.set({ rootExited: true, activeProcesses: 0, ownedProcessesStopped: true }); finish(x.sample()); await flush();
  assert.equal(x.executions.status(e.executionId, 'parent').phase, 'running');
  const repeat = x.executions.cancel(e.executionId, 'parent'); await x.clock.advance(5001); await repeat;
  assert.equal(x.cancellations(), 1);
});
test('stopped is monotonic but command exit does not finish child task; unknown coverage blocks stop', async () => {
  const x = setup(), e = await x.start();
  x.set({ rootExited: true, activeProcesses: 0, ownedProcessesStopped: true, coverageUnknown: true });
  assert.equal((await x.executions.observe(e.executionId, 'parent')).health, 'unknown');
  x.set({ rootExited: true, activeProcesses: 0, ownedProcessesStopped: true });
  assert.equal((await x.executions.observe(e.executionId, 'parent')).phase, 'stopped');
  x.set({ rootExited: false }); assert.equal((await x.executions.observe(e.executionId, 'parent')).phase, 'stopped');
  assert.equal(x.task.phase, 'active');
});
test('foreign owner, old attempt and repeated launch are fenced', async () => {
  const x = setup(), e = await x.start(); assert.equal((await x.start()).executionId, e.executionId); assert.equal(x.launched(), 1);
  assert.throws(() => x.executions.status(e.executionId, 'foreign'));
  x.task.attemptId = 'new-attempt'; await assert.rejects(x.executions.cancel(e.executionId, 'parent'));
  assert.equal(x.cancellations(), 0);
});

test('late observation of an old attempt cannot change execution evidence', async () => {
  const x = setup(), e = await x.start(); let resolve!: (s: JobSample) => void;
  x.delay(() => new Promise(r => { resolve = r; })); const poll = x.executions.observe(e.executionId, 'parent');
  x.task.attemptId = 'replacement'; x.set({ rootExited: true, activeProcesses: 0, ownedProcessesStopped: true });
  resolve(x.sample()); await poll;
  assert.equal(x.executions.all()[0]!.sample!.rootExited, false);
});

test('cancel rejection does not imply request accepted or stopped; contradictory sampling rejected', async () => {
  const x = setup(), e = await x.start(); x.fail();
  const cancel = await x.executions.cancel(e.executionId, 'parent'); assert.equal(cancel.cancelOutcomeUnknown, true);
  assert.equal(cancel.sample!.requestAccepted, false); assert.equal(cancel.safeToRetry, false);
  const y = setup(), f = await y.start(); y.set({ ownedProcessesStopped: true, rootExited: false, activeProcesses: 1 });
  assert.equal((await y.executions.observe(f.executionId, 'parent')).health, 'unknown');
});
