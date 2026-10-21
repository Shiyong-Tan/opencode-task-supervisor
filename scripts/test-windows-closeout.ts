import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { JobClient, type JobSample } from '../src/job-client.ts';
if (process.platform !== 'win32') throw Error('Windows fixture only');
const baseline = process.argv.includes('--baseline');
const helper = resolve(baseline ? '.lab/windows-closeout-baseline/JobHost.exe' : 'dist/native/JobHost.exe');
await mkdir('.lab', { recursive: true });
const root = await mkdtemp(resolve('.lab/windows-closeout-'));
const fixture = join(root, 'CloseoutFixture.exe');
execFileSync(join(process.env.WINDIR!, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', '/out:' + fixture, resolve('scripts/WindowsCloseoutFixture.cs')], { windowsHide: true });
async function run(mode: string, exit: number) {
  const release = join(root, mode + '-' + exit + '.release');
  const client = new JobClient(helper, mode + '-' + exit, root, 5000);
  const seen = new Set<number>(); let unknown = false, activeChildAfterRoot = false, released = 0;
  let sample: JobSample;
  try {
    sample = await client.call('start', { executable: fixture, args: [mode, release, String(exit)], cwd: root, artifactPaths: [] });
    const deadline = Date.now() + 110000;
    while (Date.now() < deadline) {
      unknown ||= sample.coverageUnknown;
      if (sample.rootExited && sample.activeProcesses > 0) {
        assert.equal(sample.ownedProcessesStopped, false); activeChildAfterRoot = true;
      }
      const ready = Number(await readFile(release + '.ready', 'utf8').catch(() => '0'));
      for (const member of sample.members) if (member.pid !== sample.rootPid && member.alive) {
        seen.add(member.pid);
        if (ready === member.pid && released !== ready && (mode !== 'root-exit' || sample.rootExited)) { try { await writeFile(release, String(member.pid)); released = ready; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error; } }
      }
      if (sample.rootExited && sample.activeProcesses === 0) {
        // Allow output drain and a fresh complete empty observation to settle.
        for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 20)); sample = await client.call('sample'); }
        break;
      }
      await new Promise(r => setTimeout(r, 5)); sample = await client.call('sample');
    }
    assert.equal(sample.rootExited, true); assert.equal(sample.exitCode, exit);
    if (mode === 'churn') assert.ok(seen.size >= 256, 'Fixture must exercise historical member cap');
    if (mode === 'root-exit') assert.equal(activeChildAfterRoot, true);
    if (baseline) { assert.equal(sample.coverageUnknown, true); assert.equal(sample.ownedProcessesStopped, false); }
    else { assert.equal(sample.coverageUnknown, false); assert.equal(sample.ownedProcessesStopped, true); }
    const evidence = { mode, exit, baseline, distinctMembers: seen.size, unknownObserved: unknown, activeChildAfterRoot, final: sample };
    await writeFile(join(root, mode + '-' + exit + '.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ mode, exit, baseline, distinctMembers: seen.size, finalUnknown: sample.coverageUnknown, stopped: sample.ownedProcessesStopped }));
  } finally { await client.close(); }
}
await run('churn', 0);
if (!baseline) { await run('churn', 1); await run('root-exit', 0); }
