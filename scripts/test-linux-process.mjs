import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobClient } from '../dist/job-client.js';
const directory = await mkdtemp(join(tmpdir(), 'supervisor-linux-test-'));
const helper = fileURLToPath(new URL('../dist/linux-process-host.js', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function finish(client) {
  for (let i = 0; i < 80; i++) {
    const sample = await client.call('sample');
    if (sample.ownedProcessesStopped) return sample;
    await pause(100);
  }
  throw new Error('Isolated process group did not reach stopped evidence');
}
try {
  const client = new JobClient(helper, 'linux-cpu', directory, 5000, true, process.execPath);
  try {
    const first = await client.call('start', { executable: process.execPath, args: ['-e', 'console.log("tracked"); const end=Date.now()+600; while(Date.now()<end){}; setTimeout(()=>process.exit(7),250)'], cwd: directory });
    assert.ok(first.rootPid > 0); assert.notEqual(first.rootCreationFileTime, '0');
    await pause(300); const active = await client.call('sample');
    assert.ok(BigInt(active.cpu100ns) > BigInt(first.cpu100ns)); assert.ok(active.stdout.text.includes('tracked'));
    const ended = await finish(client); assert.equal(ended.exitCode, 7); assert.equal(ended.activeProcesses, 0);
    assert.ok(ended.scope.includes('linux_owned_process_group'));
    await assert.rejects(client.call('cancel'));
  } finally { await client.close(); }
  const descendants = new JobClient(helper, 'linux-descendant', directory, 5000, true, process.execPath);
  try {
    await descendants.call('start', { executable: '/bin/sh', args: ['-c', 'sleep 1.5 & sleep 0.3; exit 0'], cwd: directory });
    await pause(500); const sample = await descendants.call('sample');
    assert.equal(sample.rootExited, true); assert.ok(sample.activeProcesses > 0); assert.equal(sample.ownedProcessesStopped, false);
    assert.equal((await finish(descendants)).ownedProcessesStopped, true);
  } finally { await descendants.close(); }
  const detach = new JobClient(helper, 'linux-detach', directory, 5000, true, process.execPath);
  const started = await detach.call('start', { executable: '/bin/sh', args: ['-c', 'sleep 1; echo survived > survived.txt'], cwd: directory });
  await detach.close(); await pause(1600);
  const { readFile } = await import('node:fs/promises');
  assert.equal((await readFile(join(directory, 'survived.txt'), 'utf8')).trim(), 'survived');
  console.log('PASS Linux/WSL: launch identity, CPU/output, nonzero exit, live descendant after root exit, no cancel, detach without killing');
} finally { await rm(directory, { recursive: true, force: true }); }
const { Supervisor } = await import('../dist/supervisor.js');
const { clock } = await import('../dist/clock.js');
const { processTools } = await import('../dist/process-tools.js');
const supervisor = new Supervisor({}, clock);
const task = supervisor.registry.register('linux_parent'); task.phase = 'dispatching'; supervisor.registry.attach(task, 'linux_child'); task.phase = 'active';
const runtime = await processTools(supervisor, process.cwd());
try {
  const args = { executable: '/bin/sh', args: ['-c', 'echo tool-tracked; sleep 0.3'], cwd: process.cwd() };
  const permissions = [];
  const context = { sessionID: 'linux_child', messageID: 'm', agent: 'coder', directory: process.cwd(), worktree: process.cwd(), abort: new AbortController().signal, metadata() {}, async ask(request) { permissions.push(request); } };
  runtime.before({ tool: 'supervisor_run', sessionID: 'linux_child', callID: 'linux_tool' }, { args });
  const launched = JSON.parse(await runtime.tools.supervisor_run.execute(args, context));
  assert.equal(launched.phase, 'running'); assert.equal(permissions.length, 1);
  const status = JSON.parse(await runtime.tools.supervisor_process_status.execute({ executionId: launched.executionId }, context));
  assert.equal(status.executionId, launched.executionId); assert.ok(status.sample.rootPid > 0);
  await assert.rejects(runtime.tools.supervisor_process_status.execute({ executionId: launched.executionId }, { ...context, sessionID: 'foreign' }));
  const ended = JSON.parse(await runtime.tools.supervisor_process_wait.execute({ executionId: launched.executionId, waitMs: 1000 }, context));
  assert.equal(ended.phase, 'stopped'); assert.equal(ended.sample.exitCode, 0); assert.ok(ended.sample.stdout.text.includes('tool-tracked'));
  console.log('PASS Linux tool boundary: trusted call, exact-command permission, execution owner, wait and result');
} finally { await runtime.dispose(); }
