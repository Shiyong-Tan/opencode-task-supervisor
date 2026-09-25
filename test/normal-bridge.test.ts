import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startNormalBridge } from '../src/normal-bridge.ts';
import { bridgeBearer, verifyConnectionLease, verifyConnectionProof, type SignedConnectionLease } from '../src/normal-connection-protocol.ts';

test('real normal bridge publishes secret-free renewable lease and live authenticated identity', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-normal-')));
  const binding = { integrationId: '11'.repeat(32), serviceId: '22'.repeat(32),
    workspace: 'd:/trial', serviceOrigin: 'http://127.0.0.1:42001' };
  const launchKey = '33'.repeat(32);
  let now = 1_000;
  const options = { openCodeVersion: '1.18.31' as const, binding, launchKey, directory, now: () => now,
    snapshot: async (parentSessionId: string) => ({ parentSessionId }) };
  const bridge = await startNormalBridge(options);
  try {
    await assert.rejects(startNormalBridge(options));
    const text = await readFile(bridge.file, 'utf8');
    assert.ok(!text.includes(launchKey));
    const lease = verifyConnectionLease(JSON.parse(text), binding, launchKey, now);
    const token = bridgeBearer(launchKey, binding, lease.instanceId);
    assert.ok(!text.includes(token));
    const challenge = '44'.repeat(32);
    const endpoint = `${lease.bridgeOrigin}/v1/identity?challenge=${challenge}`;
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(endpoint)).status, 401);
    const response = await (await fetch(endpoint, { headers })).json() as { lease: SignedConnectionLease; proof: string };
    const verified = verifyConnectionLease(response.lease, binding, launchKey, now);
    assert.equal(verifyConnectionProof(response.proof, launchKey, verified, challenge), true);
    now = 61_000;
    assert.equal((await fetch(endpoint, { headers })).status, 502);
    assert.equal((await fetch(`${lease.bridgeOrigin}/v1/snapshot?parentSessionId=ses_A`, { headers })).status, 502);
    await bridge.renew();
    const fresh = verifyConnectionLease(JSON.parse(await readFile(bridge.file, 'utf8')), binding, launchKey, now);
    assert.equal(fresh.instanceId, lease.instanceId);
    assert.equal(fresh.issuedAt, now);
    assert.deepEqual(await (await fetch(`${lease.bridgeOrigin}/v1/snapshot?parentSessionId=ses_A`, { headers })).json(), { parentSessionId: 'ses_A' });
    await bridge.close();
    await bridge.close();
    await bridge.renew();
    await assert.rejects(readFile(bridge.file));
    await assert.rejects(fetch(endpoint, { headers }));
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});

test('normal bridge cleanup never deletes substituted discovery evidence', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-normal-')));
  const bridge = await startNormalBridge({ openCodeVersion: '1.18.29', directory, launchKey: '11'.repeat(32),
    binding: { integrationId: '22'.repeat(32), serviceId: '33'.repeat(32), workspace: 'd:/trial', serviceOrigin: 'http://127.0.0.1:42001' },
    snapshot: async () => ({}), now: () => 1_000 });
  try {
    await writeFile(bridge.file, '{"foreign":true}');
    await assert.rejects(bridge.renew());
    await bridge.close();
    assert.equal(await readFile(bridge.file, 'utf8'), '{"foreign":true}');
    await assert.rejects(startNormalBridge({ openCodeVersion: '1.18.29', directory, launchKey: '11'.repeat(32),
      binding: { integrationId: '22'.repeat(32), serviceId: '33'.repeat(32), workspace: 'd:/trial', serviceOrigin: 'http://127.0.0.1:42001' },
      snapshot: async () => ({}), now: () => 1_000 }));
    assert.equal(await readFile(bridge.file, 'utf8'), '{"foreign":true}');
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});
