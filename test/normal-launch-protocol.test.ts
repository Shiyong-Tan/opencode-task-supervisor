import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { parseNormalLaunch, type NormalLaunch } from '../src/normal-launch-protocol.ts';
import { serviceAuthenticationProof } from '../src/normal-connection-protocol.ts';

test('launch metadata requires exact actual service, workspace and authentication', () => {
  const binding = { integrationId: '11'.repeat(32), serviceId: '22'.repeat(32), workspace: 'd:/trial', serviceOrigin: 'http://127.0.0.1:42001' };
  const launchKey = '33'.repeat(32);
  const authorization = `Basic ${Buffer.from('opencode:test-only-password').toString('base64')}`;
  const launch: NormalLaunch = { schemaVersion: 1, kind: 'normal-gui-launch', binding, launchKey,
    identityKey: '44'.repeat(32), privateDirectory: tmpdir(), authenticationProof: serviceAuthenticationProof(launchKey, binding, authorization) };
  const serialized = JSON.stringify(launch);
  assert.deepEqual(parseNormalLaunch(serialized, 'D:\\trial', binding.serviceOrigin, authorization), launch);
  for (const [workspace, origin, auth] of [
    ['d:/other', binding.serviceOrigin, authorization], ['d:/trial', 'http://127.0.0.1:42002', authorization],
    ['d:/trial', binding.serviceOrigin, `Basic ${Buffer.from('opencode:other-password').toString('base64')}`],
  ]) assert.throws(() => parseNormalLaunch(serialized, workspace!, origin!, auth!));
  for (const change of [{ schemaVersion: 2 }, { token: launchKey }, { privateDirectory: 'relative' },
    { identityKey: 'bad' }, { binding: { ...binding, serviceId: '55'.repeat(32) } }]) {
    assert.throws(() => parseNormalLaunch(JSON.stringify({ ...launch, ...change }), 'd:/trial', binding.serviceOrigin, authorization));
  }
  for (const value of ['bad-json', 'x'.repeat(16_385)]) {
    assert.throws(() => parseNormalLaunch(value, 'd:/trial', binding.serviceOrigin, authorization));
  }
  assert.ok(!serialized.includes(authorization));
  assert.ok(!serialized.includes('test-only-password'));
});
