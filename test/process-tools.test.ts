import test from 'node:test';
import assert from 'node:assert/strict';
import { processTools, processGuidance } from '../src/process-tools.ts';
import { Supervisor } from '../src/supervisor.ts';
import { FakeApi, FakeClock, flush, snapshot } from './helpers.ts';
import type { JobSample } from '../src/job-client.ts';
import { ViewProjection } from '../src/view-projection.ts';

async function setup() {
  const clock = new FakeClock(), api = new FakeApi(), supervisor = new Supervisor(api, clock);
  const task = supervisor.registry.register('ses_parent'); task.phase = 'dispatching'; supervisor.registry.attach(task, 'ses_child'); task.phase = 'active';
  let launches = 0, denied = false, changes: Partial<JobSample> = {};
  const runtime = await processTools(supervisor, process.cwd(), executionId => {
    let sequence = 0; launches++;
    return { async call(op) {
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
  const start = async (callId: string, sessionID = 'ses_child') => {
    const args = { executable: process.execPath, args: ['-e', '/* no actual launch */'], cwd: process.cwd() };
    runtime.before({ tool: 'supervisor_run', sessionID, callID: callId }, { args });
    return JSON.parse(await runtime.tools.supervisor_run.execute(args, ctx(sessionID)));
  };
  return { supervisor, clock, api, runtime, task, start, ctx, permissions, launches: () => launches,
    set: (v: Partial<JobSample>) => { changes = v; }, deny: () => { denied = true; } };
}

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
  const wait = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId, waitMs: 1000 }, x.ctx());
  await flush(); await x.clock.advance(1000);
  assert.equal(JSON.parse(await wait).executionId, e.executionId); assert.equal(x.launches(), 1);
  const abort = new AbortController(), interrupted = x.runtime.tools.supervisor_process_wait.execute({ executionId: e.executionId, waitMs: 1000 }, { ...x.ctx(), abort: abort.signal });
  abort.abort(); await assert.rejects(interrupted);
  assert.equal(x.runtime.executions.status(e.executionId, 'ses_child').phase, 'running');
  x.task.attemptId = 'replaced'; await assert.rejects(x.runtime.tools.supervisor_process_status.execute({ executionId: e.executionId }, x.ctx()));
  assert.match(processGuidance, /Never finalize/); assert.match(processGuidance, /ordinary shell processes are not tracked/);
});
