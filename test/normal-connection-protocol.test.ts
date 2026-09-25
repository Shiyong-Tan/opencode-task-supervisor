import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeBearer, canonicalWindowsWorkspace, connectionProof, signConnectionLease,
  verifyConnectionLease, verifyConnectionProof, type ConnectionLease } from '../src/normal-connection-protocol.ts';

const key = '11'.repeat(32);
const lease: ConnectionLease = {
  schemaVersion: 1, kind: 'normal-gui', integrationId: '22'.repeat(32), serviceId: '33'.repeat(32),
  workspace: 'd:/trial/work', serviceOrigin: 'http://127.0.0.1:42001', instanceId: '44'.repeat(32),
  bridgeOrigin: 'http://127.0.0.1:54321', opencodeVersion: '1.18.29', pluginVersion: '0.1.0',
  issuedAt: 10_000, expiresAt: 70_000,
};

test('normal connection lease binds exact service and canonical workspace without publishing secrets', () => {
  assert.equal(canonicalWindowsWorkspace('D:\\Trial\\Work\\'), lease.workspace);
  const signed = signConnectionLease(lease, key);
  assert.deepEqual(verifyConnectionLease(JSON.parse(JSON.stringify(signed)), lease, key, 10_000), lease);
  const token = bridgeBearer(key, lease, lease.instanceId);
  assert.ok(!JSON.stringify(signed).includes(key));
  assert.ok(!JSON.stringify(signed).includes(token));
});

test('connection lease rejects stale, future, wrong service, workspace, integration and credentials', () => {
  const signed = signConnectionLease(lease, key);
  for (const now of [9_999, 70_000, 80_000, NaN]) {
    assert.throws(() => verifyConnectionLease(signed, lease, key, now));
  }
  for (const patch of [{ serviceId: '55'.repeat(32) }, { workspace: 'd:/other' },
    { serviceOrigin: 'http://127.0.0.1:42002' }, { integrationId: '66'.repeat(32) }]) {
    assert.throws(() => verifyConnectionLease(signed, { ...lease, ...patch }, key, 20_000));
  }
  assert.throws(() => verifyConnectionLease(signed, lease, '77'.repeat(32), 20_000));
});

test('strict parsing rejects malformed, foreign version, ambiguous and excessive lifetime records', () => {
  for (const patch of [{ schemaVersion: 2 }, { kind: 'lab' }, { opencodeVersion: 'malformed-version' },
    { pluginVersion: '2.0.0' }, { bridgeOrigin: 'http://localhost:54321' },
    { bridgeOrigin: 'http://127.0.0.1:54321/secret' }, { bridgeOrigin: 'http://127.0.0.1:99999' },
    { workspace: 'D:/trial/work' }, { issuedAt: -1 }, { expiresAt: 70_001 },
    { expiresAt: 10_000 }, { token: key }, { serviceId: '../escape' }]) {
    assert.throws(() => signConnectionLease({ ...lease, ...patch } as ConnectionLease, key));
  }
  const signed = signConnectionLease(lease, key);
  assert.throws(() => verifyConnectionLease({ ...signed, auth: key }, lease, key, 20_000));
  assert.throws(() => verifyConnectionLease({ ...signed, signature: 'short' }, lease, key, 20_000));
  for (const workspace of ['relative', 'd:/a/../b', 'd:/a//b', '\\\\host\\share', 'd:/a\n']) {
    assert.throws(() => canonicalWindowsWorkspace(workspace));
  }
});

test('tampering and bridge restarts cannot reuse discovery signatures or live challenge proofs', () => {
  const signed = signConnectionLease(lease, key);
  assert.throws(() => verifyConnectionLease({ ...signed, payload: { ...lease, bridgeOrigin: 'http://127.0.0.1:54322' } }, lease, key, 20_000));
  const challenge = '88'.repeat(32);
  const proof = connectionProof(key, lease, challenge);
  assert.equal(verifyConnectionProof(proof, key, lease, challenge), true);
  assert.equal(verifyConnectionProof(proof, key, lease, '99'.repeat(32)), false);
  const restarted = { ...lease, instanceId: 'aa'.repeat(32) };
  assert.equal(verifyConnectionProof(proof, key, restarted, challenge), false);
  assert.notEqual(bridgeBearer(key, restarted, restarted.instanceId), bridgeBearer(key, lease, lease.instanceId));
  assert.equal(verifyConnectionProof(signed.signature, key, lease, challenge), false);
  assert.equal(verifyConnectionProof(bridgeBearer(key, lease, lease.instanceId), key, lease, challenge), false);
});
