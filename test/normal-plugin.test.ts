import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareNormalPlugin } from '../src/normal-plugin.ts';
import { canonicalWindowsWorkspace, serviceAuthenticationProof } from '../src/normal-connection-protocol.ts';
import { ViewProjection } from '../src/view-projection.ts';
import { Registry } from '../src/registry.ts';
import { FakeClock } from './helpers.ts';
import { encodeNormalView, parseNormalView } from '../src/normal-view-protocol.ts';

test('normal bootstrap consumes private environment metadata and rejects another workspace', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-normal-plugin-')));
  try {
    const privateDirectory = join(root, 'private');
    const other = join(root, 'other');
    await mkdir(privateDirectory); await mkdir(other);
    const authorization = `Basic ${Buffer.from('opencode:test-only').toString('base64')}`;
    const binding = { integrationId: '11'.repeat(32), serviceId: '22'.repeat(32),
      workspace: canonicalWindowsWorkspace(root), serviceOrigin: 'http://127.0.0.1:42001' };
    const launchKey = '33'.repeat(32);
    const serialized = JSON.stringify({ schemaVersion: 1, kind: 'normal-gui-launch', binding, launchKey,
      identityKey: '44'.repeat(32), privateDirectory, authenticationProof: serviceAuthenticationProof(launchKey, binding, authorization) });
    const env = { OPENCODE_GUI_SUPERVISOR_BINDING: serialized };
    const normal = await prepareNormalPlugin({ enabled: true }, root, binding.serviceOrigin, authorization, env);
    assert.equal(env.OPENCODE_GUI_SUPERVISOR_BINDING, undefined);
    assert.equal(normal.launch.binding.integrationId, binding.integrationId);
    await assert.rejects(prepareNormalPlugin({ enabled: true }, root, binding.serviceOrigin, authorization, env));
    const foreign = { OPENCODE_GUI_SUPERVISOR_BINDING: serialized };
    await assert.rejects(prepareNormalPlugin({ enabled: true }, other, binding.serviceOrigin, authorization, foreign));
    assert.equal(foreign.OPENCODE_GUI_SUPERVISOR_BINDING, undefined);
    await assert.rejects(prepareNormalPlugin({ enabled: false }, root, binding.serviceOrigin, authorization, {}));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('normal view adapter preserves existing projection owners while rejecting foreign wire identity', () => {
  const clock = new FakeClock();
  const registry = new Registry(clock);
  registry.register('ses_A'); registry.register('ses_B');
  const integrationId = '11'.repeat(32), serviceId = '22'.repeat(32), instanceId = '33'.repeat(32);
  const projection = new ViewProjection(registry, clock, { pluginVersion: '0.1.0', openCodeVersion: '1.18.29', isolationId: integrationId },
    undefined, undefined, undefined, undefined, instanceId);
  const before = projection.snapshot('ses_A');
  const wire = encodeNormalView(before, serviceId) as Record<string, unknown>;
  assert.equal(Object.hasOwn(wire, 'isolationId'), false);
  assert.equal(wire.schemaVersion, 2);
  assert.equal(wire.instanceId, instanceId);
  assert.deepEqual(parseNormalView(wire, integrationId, serviceId), before);
  for (const change of [{ schemaVersion: 1 }, { serviceId: '44'.repeat(32) }, { integrationId: '55'.repeat(32) },
    { isolationId: integrationId }, { scope: 'isolated_allowlisted_commands' }, { parentSessionId: 'ses_B' }]) {
    assert.throws(() => parseNormalView({ ...wire, ...change }, integrationId, serviceId));
  }
});
