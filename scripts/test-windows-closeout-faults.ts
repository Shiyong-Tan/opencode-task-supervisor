import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { JobClient } from '../src/job-client.ts';
if (process.platform !== 'win32') throw Error('Windows fixture only');
await mkdir('.lab', { recursive: true });
const root = await mkdtemp(resolve('.lab/windows-closeout-faults-'));
const original = await readFile('native/JobHost.cs', 'utf8');
for (const scenario of ['open-once-87', 'open-always-5', 'query-once-5']) {
  // Fault seams exist only in isolated compiled copies, never the shipped host.
  const query = scenario.startsWith('query');
  const declaration = query
    ? '[DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, IntPtr info, uint size, out uint returned);'
    : '[DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);';
  const replacement = query
    ? '[DllImport("kernel32.dll", EntryPoint="QueryInformationJobObject", SetLastError=true)] static extern bool NativeQuery(IntPtr job,int type,IntPtr info,uint size,out uint returned); static int calls; static bool QueryInformationJobObject(IntPtr job,int type,IntPtr info,uint size,out uint returned){if(++calls==4){returned=0;SetLastError(5);return false;}return NativeQuery(job,type,info,size,out returned);}'
    : '[DllImport("kernel32.dll", EntryPoint="OpenProcess", SetLastError=true)] static extern IntPtr NativeOpen(uint access,bool inherit,uint pid); static int calls; static IntPtr OpenProcess(uint access,bool inherit,uint pid){if(' + (scenario.includes('always') ? 'true' : '++calls==1') + '){SetLastError(' + (scenario.endsWith('87') ? '87' : '5') + ');return IntPtr.Zero;}return NativeOpen(access,inherit,pid);}';
  assert.ok(original.includes(declaration));
  const source = original.replace(declaration, replacement + '\n [DllImport("kernel32.dll", SetLastError=true)] static extern void SetLastError(uint code);');
  const cs = join(root, scenario + '.cs'), exe = join(root, scenario + '.exe');
  await writeFile(cs, source);
  execFileSync(join(process.env.WINDIR!, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', '/r:System.Web.Extensions.dll', '/out:' + exe, cs], { windowsHide: true });
  const client = new JobClient(exe, scenario, root, 5000);
  let observedUnknown = false, observedError = false, recovered = false;
  try {
    let sample = await client.call('start', { executable: process.execPath, args: [resolve('scripts/windows-closeout-fixture.cjs'), 'finite', 'unused', '0'], cwd: root });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (sample.coverageUnknown) { observedUnknown = true; assert.equal(sample.ownedProcessesStopped, false); }
      if ((observedUnknown || observedError) && !sample.coverageUnknown) recovered = true;
      if (sample.ownedProcessesStopped) break;
      await new Promise(r => setTimeout(r, 10));
      try { sample = await client.call('sample'); }
      catch (error) { observedError = true; assert.match(String(error), /QueryInformationJobObject\(accounting-before\).*Win32 5/); }
    }
    assert.equal(query ? observedError : observedUnknown, true);
    assert.equal(recovered, true); assert.equal(sample.ownedProcessesStopped, true);
    if (!query) assert.ok(sample.observation);
    await writeFile(join(root, scenario + '.json'), JSON.stringify({ observedUnknown, observedError, recovered, final: sample }, null, 2));
    console.log(JSON.stringify({ scenario, observedUnknown, observedError, recovered, stopped: sample.ownedProcessesStopped }));
  } finally { await client.close(); }
}
