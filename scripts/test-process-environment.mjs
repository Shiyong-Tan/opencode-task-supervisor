import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobClient } from '../dist/job-client.js';

const root = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-env-test-')));
const linux = process.platform === 'linux';
const helper = fileURLToPath(new URL(linux ? '../dist/linux-process-host.js' : '../dist/native/JobHost.exe', import.meta.url));
const before = process.env.TMP;
const client = new JobClient(helper, 'environment-fixture', root, 5000, true, linux ? process.execPath : undefined);
try {
  const marker = '环境 override';
  const code = `const c=require('child_process'); console.log(JSON.stringify({tmp:require('os').tmpdir(),marker:process.env.SUPERVISOR_ENV_FIXTURE,nested:c.execFileSync(process.execPath,['-e','process.stdout.write(process.env.SUPERVISOR_ENV_FIXTURE)'],{encoding:'utf8',windowsHide:true})}));setTimeout(()=>{},200);`;
  await client.call('start', { executable: process.execPath, args: ['-e', code], cwd: root,
    env: { TMP: root, TEMP: root, TMPDIR: root, SUPERVISOR_ENV_FIXTURE: marker } });
  let ended;
  for (let i = 0; i < 100; i++) {
    ended = await client.call('sample');
    if (ended.ownedProcessesStopped) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ended.ownedProcessesStopped, true); assert.equal(ended.exitCode, 0);
  const output = JSON.parse(ended.stdout.text.trim());
  assert.equal(output.tmp, root); assert.equal(output.marker, marker); assert.equal(output.nested, marker);
  assert.equal(process.env.TMP, before);
  console.log('PASS child and descendant environment, Unicode, temp directory, exit and unchanged parent environment');
} finally {
  await client.close();
  const base = await realpath(tmpdir());
  if (!root.startsWith(base + sep) || !basename(root).startsWith('supervisor-env-test-')) throw new Error('Invalid fixture cleanup path');
  await rm(root, { recursive: true, force: true });
}
