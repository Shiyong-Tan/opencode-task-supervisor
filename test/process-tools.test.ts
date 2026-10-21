import test from 'node:test';
import assert from 'node:assert/strict';
import { processTools, processGuidance } from '../src/process-tools.ts';
import { Supervisor } from '../src/supervisor.ts';
import { FakeApi, FakeClock, flush, snapshot } from './helpers.ts';
import type { JobSample } from '../src/job-client.ts';
import { ViewProjection } from '../src/view-projection.ts';
import { processProgress } from '../src/process-progress.ts';

async function setup() {
  const clock = new FakeClock(), api = new FakeApi(), supervisor = new Supervisor(api, clock);
  const task = supervisor.registry.register('ses_parent'); task.phase = 'dispatching'; supervisor.registry.attach(task, 'ses_child'); task.phase = 'active';
  let launches = 0, denied = false, changes: Partial<JobSample> = {};
  const commands: unknown[] = [];
  const runtime = await processTools(supervisor, process.cwd(), executionId => {
    let sequence = 0; launches++;
    return { async call(op, command) {
      if (op === 'start') commands.push(command);
      assert.notEqual(op, 'cancel');
      return { executionId, sequence: ++sequence, observedAt: new Date(0).toISOString(), rootPid: 12, rootCreationFileTime: '123',
        rootExited: false, exitCode: null, activeProcesses: 1, members: [], cpu100ns: '0', readBytes: '0', writeBytes: '0', workingSetBytes: '1048576',
        requestAccepted: false, ownedProcessesStopped: false, coverageUnknown: false, cancelOutcomeUnknown: false,
        stdout: { text: 'private output', totalBytes: 14, retainedBytes: 14, truncated: false },
        stderr: { text: '', totalBytes: 0, retainedBytes: 0, truncated: false }, scope: 'local', ...changes };
    }, async close() { return false; } };
  });
  const permissions: unknown[] = [];
  const ctx = (sessionID = 'ses_child') => ({ sessionID, messageID: 'message_1', agent: 'coder', directory: process.cwd(), worktree: process.cwd(),
    abort: new AbortController().signal, metadata() {}, async ask(request: unknown) { permissions.push(request); if (denied) throw Error('denied'); } });
  const start = async (callId: string, sessionID = 'ses_child', env?: Record<string, string>, plan: import('../src/process-review.ts').ProcessReviewPlan = {}) => {
    const args = { executable: process.execPath, args: ['-e', '/* no actual launch */'], cwd: process.cwd(), ...(env ? { env } : {}), ...plan };
    runtime.before({ tool: 'supervisor_run', sessionID, callID: callId }, { args });
    return JSON.parse(await runtime.tools.supervisor_run.execute(args, ctx(sessionID)));
  };
  return { supervisor, clock, api, runtime, task, start, ctx, permissions, commands, launches: () => launches,
    set: (v: Partial<JobSample>) => { changes = v; }, deny: () => { denied = true; } };
}

test('environment overrides are permission-bound, forwarded once and absent from process status', async () => {
  const x = await setup();
  const env = { TMP: 'project-private-temp', TMPDIR: 'project-private-temp' };
  const execution = await x.start('environment', 'ses_child', env);
  assert.deepEqual((x.commands[0] as { env: unknown }).env, env);
  assert.match(JSON.stringify(x.permissions), /project-private-temp/);
  assert.ok(!JSON.stringify(execution).includes('project-private-temp'));
  await x.start('environment', 'ses_child', env); assert.equal(x.commands.length, 1);
  await assert.rejects(x.start('invalid-env', 'ses_child', { 'BAD=NAME': 'x' }), /environment/);
  assert.equal(x.commands.length, 1);
});

test('trusted child launch checks exact command permission; foreign/direct calls cannot launch', async () => {
  const x = await setup();
  await assert.rejects(x.runtime.tools.supervisor_run.execute({ executable: process.execPath, args: [], cwd: process.cwd() }, x.ctx()), /trusted/);
  await assert.rejects(x.start('parent_call', 'ses_parent'), /registered child/);
  assert.equal(x.launches(), 0);
  const e = await x.start('call_1'); assert.equal(e.phase, 'running');
  assert.equal(x.launches(), 1); assert.match(JSON.stringify(x.permissions), /supervisor_run/);
  assert.match(JSON.stringify(x.permissions), /no actual launch/);
  assert.ok(!(await x.runtime.tools.supervisor_process_status.execute({}, x.ctx('ses_parent'))).includes('private output'));
  await assert.rejects(x.runtime.tools.supervisor_process_status.execute({ executionId: e.executionId }, x.ctx('ses_foreign')));
  assert.equal(await x.runtime.tools.supervisor_process_status.execute({}, x.ctx('ses_foreign')), '[]');
  assert.equal(Object.keys(x.runtime.tools).some(k => k.includes('cancel')), false);
});

test('permission denial never starts, repeated call is idempotent, separate commands retain distinct identity', async () => {
  const x = await setup(); x.deny(); const denied = await x.start('denied');
  assert.equal(denied.phase, 'permission_denied'); assert.equal(x.launches(), 0);
  const y = await setup(), first = await y.start('one'), again = await y.start('one'), second = await y.start('two');
  assert.equal(first.executionId, again.executionId); assert.notEqual(first.executionId, second.executionId); assert.equal(y.launches(), 2);
  assert.equal(JSON.parse(await y.runtime.tools.supervisor_process_status.execute({}, y.ctx('ses_parent'))).length, 2);
});

test('registered processes block premature completion; CPU activity projects metrics without private output', async () => {
  const x = await setup(), e = await x.start('run');
  x.api.snapshots.set('ses_child', snapshot('ses_child', { status: 'idle', terminal: 'completed' }));
  await x.supervisor.observe(x.task.taskId, 'ses_parent'); assert.equal(x.task.phase, 'active');
  await x.clock.advance(1000); x.set({ cpu100ns: '10000000' }); await x.runtime.tick();
  const evidence = x.supervisor.processEvidence!(x.task)!; assert.equal(evidence.process, 'active'); assert.equal(evidence.pending, true);
  const view = new ViewProjection(x.supervisor.registry, x.clock, { pluginVersion: '0.1.0', openCodeVersion: '1.18.31', isolationId: 'test' }, () => x.runtime.executions.all());
  const projected = view.snapshot('ses_parent'); assert.equal(projected.executions[0]!.cpuPercent, 100);
  assert.equal(projected.executions[0]!.workingSetBytes, '1048576'); assert.equal(projected.executions[0]!.durationMs, 1000);
  assert.ok(!JSON.stringify(projected).includes('private output'));
  x.set({ cpu100ns: '10000000', rootExited: true, exitCode: 0, activeProcesses: 1 }); await x.runtime.tick();
  assert.equal(x.supervisor.processEvidence!(x.task)!.pending, true);
  x.set({ cpu100ns: '10000000', rootExited: true, exitCode: 0, activeProcesses: 0, ownedProcessesStopped: true }); await x.runtime.tick();
  assert.equal(x.supervisor.processEvidence!(x.task)!.pending, false);
  const duration = x.runtime.executions.status(e.executionId, 'ses_parent').finishedAt;
  await x.clock.advance(5000); assert.equal(x.runtime.executions.status(e.executionId, 'ses_parent').finishedAt, duration);
});

test('wait checkpoint returns same execution; cancellation of wait does not stop execution', async () => {
  const x = await setup(), e = await x.start('run');
  const wait = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId, mode: 'checkpoint', waitMs: 1000 }, x.ctx());
  await flush(); await x.clock.advance(1000);
  assert.equal(JSON.parse(await wait).executionId, e.executionId); assert.equal(x.launches(), 1);
  const abort = new AbortController(), interrupted = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId, mode: 'checkpoint', waitMs: 1000 }, { ...x.ctx(), abort: abort.signal });
  abort.abort(); await assert.rejects(interrupted);
  assert.equal(x.runtime.executions.status(e.executionId, 'ses_child').phase, 'running');
  x.task.attemptId = 'replaced'; await assert.rejects(x.runtime.tools.supervisor_process_status.execute({ executionId: e.executionId }, x.ctx()));
  assert.match(processGuidance, /Never finalize/); assert.match(processGuidance, /ordinary shell processes are not tracked/);
});

test('wait progress reports cumulative execution time and fresh metrics without private output', async () => {
  const x = await setup(), e = await x.start('run');
  await x.clock.advance(61000);
  const titles: string[] = [];
  const wait = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId, mode: 'checkpoint', waitMs: 1000 },
    { ...x.ctx(), metadata: value => { if (value.title) titles.push(value.title); } });
  await flush();
  assert.match(titles[0]!, /Elapsed 1m 1s.*Observation uncertain/);
  x.set({ cpu100ns: '620000000' }); await x.clock.advance(1000); await wait;
  assert.match(titles.at(-1)!, /Elapsed 1m 2s.*CPU 100.0%.*1 live processes/);
  assert.ok(!JSON.stringify(titles).includes('private output'));
  const value = x.runtime.executions.status(e.executionId, 'ses_child');
  assert.match(processProgress({ ...value, health: 'unknown' }, x.clock.now()), /Observation uncertain/);
  assert.ok(!processProgress({ ...value, health: 'unknown' }, x.clock.now()).includes('CPU'));
  assert.match(processProgress({ ...value, finishedAt: 62000, phase: 'stopped', health: 'stopped',
    sample: { ...value.sample!, exitCode: 0 } }, 62000), /Elapsed 1m 2s.*Exited 0/);
});

test('default process wait stays open beyond timed checkpoints and returns on completion', async () => {
  const x = await setup(), e = await x.start('quiet-wait');
  let returned = false;
  const pending = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId, waitMs: 1000 }, x.ctx())
    .then(value => { returned = true; return JSON.parse(value); });
  await flush();
  x.set({ cpu100ns: '1200000000' }); await x.clock.advance(120000);
  assert.equal(returned, false); assert.equal(x.launches(), 1);
  x.set({ cpu100ns: '1200000000', rootExited: true, activeProcesses: 0, ownedProcessesStopped: true, exitCode: 0 });
  await x.clock.advance(1000);
  const result = await pending;
  assert.equal(result.phase, 'stopped'); assert.equal(result.sample.exitCode, 0); assert.equal(result.executionId, e.executionId);
});

test('default process wait surfaces uncertain/quiet evidence for review without terminating or retrying', async () => {
  for (const kind of ['unknown', 'suspect'] as const) {
    const x = await setup(), e = await x.start('quiet-wait');
    const pending = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId }, x.ctx());
    await flush();
    if (kind === 'unknown') x.set({ coverageUnknown: true });
    await x.clock.advance(kind === 'suspect' ? 300000 : 1000);
    const result = JSON.parse(await pending);
    assert.equal(result.health, kind); assert.equal(result.phase, 'running'); assert.equal(result.safeToRetry, false);
    assert.equal(x.launches(), 1); assert.equal(x.runtime.executions.status(e.executionId, 'ses_child').cancelRequested, false);
  }
});

test('estimated inspection deadline returns despite useful CPU and blind waits cannot acknowledge it', async () => {
  const x = await setup(), e = await x.start('deadline', 'ses_child', undefined, {
    estimatedDurationMs: 2000, estimateReason: 'Prior fixture took two seconds', progressExpectation: 'Expect a completion receipt' });
  const wait = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId }, x.ctx());
  await flush(); x.set({ cpu100ns: '20000000' }); await x.clock.advance(2000);
  const alert = JSON.parse(await wait);
  assert.equal(alert.review.needed, true); assert.equal(alert.health, 'suspect');
  assert.equal(alert.phase, 'running'); assert.equal(alert.safeToRetry, false);
  const repeat = JSON.parse(await x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId }, x.ctx()));
  assert.equal(repeat.review.dueAt, 2000); assert.equal(repeat.review.count, 0);
  assert.equal(x.launches(), 1); assert.equal(alert.cancelRequested, false);
  x.api.snapshots.set('ses_child', snapshot('ses_child', { process: 'active' }));
  await x.supervisor.observe(x.task.taskId, 'ses_parent');
  assert.equal(x.task.health, 'suspected_stall');
  const reviewed = JSON.parse(await x.runtime.tools.supervisor_process_review.execute({ executionId: e.executionId,
    checkAfterMs: 3000, reason: 'Inspected output: checkpoint reached; allow bounded completion' }, x.ctx()));
  assert.equal(reviewed.review.count, 1); assert.equal(reviewed.review.dueAt, 5000);
  assert.equal(reviewed.lastActivityAt, alert.lastActivityAt);
  const next = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId }, x.ctx());
  await flush(); await x.clock.advance(3000);
  assert.equal(JSON.parse(await next).review.needed, true);
  assert.ok(!JSON.stringify(x.commands).includes('estimateReason'));
});

test('read probes and tiny CPU ticks do not indefinitely hide an inactive process', async () => {
  const x = await setup(), e = await x.start('read-poll');
  for (let i = 1; i <= 5; i++) {
    x.set({ cpu100ns: String(i * 1000), readBytes: String(i * 100000) });
    await x.clock.advance(60000); await x.runtime.tick();
  }
  const result = x.runtime.executions.status(e.executionId, 'ses_child');
  assert.equal(result.health, 'suspect'); assert.equal(result.lastActivityAt, 0);
  assert.equal(result.cancelRequested, false);
  const extension = JSON.parse(await x.runtime.tools.supervisor_process_review.execute({ executionId: e.executionId,
    checkAfterMs: 2000, reason: 'Confirmed an intentional two-second external wait' }, x.ctx()));
  assert.equal(extension.lastActivityAt, 0);
  await x.clock.advance(2000); await x.runtime.tick();
  assert.equal(x.runtime.executions.status(e.executionId, 'ses_child').health, 'suspect');
});

test('unknown estimate defaults to ten-minute review even with continuous output', async () => {
  const x = await setup(), e = await x.start('default-deadline');
  assert.equal(e.review.dueAt, 600000);
  const pending = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId }, x.ctx());
  await flush();
  x.set({ stdout: { text: 'heartbeat', totalBytes: 99, retainedBytes: 9, truncated: false } });
  await x.clock.advance(600000);
  const alert = JSON.parse(await pending);
  assert.equal(alert.review.needed, true); assert.equal(alert.lastActivityAt, 600000);
  assert.equal(alert.phase, 'running'); assert.equal(x.launches(), 1);
});

test('review validation and owner fences never launch or release another process', async () => {
  const x = await setup();
  await assert.rejects(x.start('bad-estimate', 'ses_child', undefined, { estimatedDurationMs: 2000 }), /estimateReason/);
  assert.equal(x.launches(), 0);
  const e = await x.start('valid');
  await assert.rejects(x.runtime.tools.supervisor_process_review.execute({ executionId: e.executionId, checkAfterMs: 0, reason: 'x' }, x.ctx()), /interval/);
  await assert.rejects(x.runtime.tools.supervisor_process_review.execute({ executionId: e.executionId, checkAfterMs: 2000, reason: ' ' }, x.ctx()), /explanation/);
  await assert.rejects(x.runtime.tools.supervisor_process_review.execute({ executionId: e.executionId, checkAfterMs: 2000, reason: 'x' }, x.ctx('ses_foreign')), /owned/);
  x.set({ coverageUnknown: true });
  await assert.rejects(x.runtime.tools.supervisor_process_review.execute({ executionId: e.executionId, checkAfterMs: 2000, reason: 'x' }, x.ctx()), /uncertain/);
  assert.equal(x.launches(), 1);
});

test('aborting an indefinite process wait only releases observation', async () => {
  const x = await setup(), e = await x.start('quiet-wait'), abort = new AbortController();
  const pending = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId }, {...x.ctx(), abort:abort.signal});
  await flush(); abort.abort(new Error('operator paused')); await assert.rejects(pending, /operator paused/);
  assert.equal(x.runtime.executions.status(e.executionId,'ses_child').phase,'running'); assert.equal(x.launches(),1);
});

for (const exitCode of [0, 1]) test(`fresh status recovers uncertain coverage without relaunch (exit ${exitCode})`, async () => {
  const x = await setup(), e = await x.start('recover');
  x.set({ coverageUnknown: true });
  const uncertain = JSON.parse(await x.runtime.tools.supervisor_process_status.execute({ executionId: e.executionId }, x.ctx()));
  assert.equal(uncertain.health, 'unknown'); assert.equal(uncertain.safeToRetry, false);
  x.set({ rootExited: true, exitCode, activeProcesses: 0, ownedProcessesStopped: true, coverageUnknown: false });
  const final = JSON.parse(await x.runtime.tools.supervisor_process_status.execute({ executionId: e.executionId }, x.ctx()));
  assert.equal(final.sample.ownedProcessesStopped, true); assert.equal(final.sample.exitCode, exitCode);
  assert.equal(x.launches(), 1);
});
