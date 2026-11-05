import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareNormalPlugin, startNormalPlugin } from '../src/normal-plugin.ts';
import { canonicalWindowsWorkspace, serviceAuthenticationProof, verifyConnectionLease } from '../src/normal-connection-protocol.ts';
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
  const todos = { sessionId: before.parentSessionId, revision: 1,
    items: [{ id: 'audit', content: 'Audit', status: 'pending' as const, priority: 'high' as const }] };
  assert.deepEqual(parseNormalView(encodeNormalView({ ...before, todos }, serviceId), integrationId, serviceId).todos, todos);
  assert.throws(() => encodeNormalView({ ...before, todos: { ...todos, sessionId: 'ses_foreign' } }, serviceId));
  for (const change of [{ schemaVersion: 1 }, { serviceId: '44'.repeat(32) }, { integrationId: '55'.repeat(32) },
    { isolationId: integrationId }, { scope: 'isolated_allowlisted_commands' }, { parentSessionId: 'ses_B' }]) {
    assert.throws(() => parseNormalView({ ...wire, ...change }, integrationId, serviceId));
  }
});


test('discovery heartbeat renews without any task-monitor tick and stops on close', async t => {
  const lab = join(process.cwd(), '.lab'); await mkdir(lab, { recursive: true });
  const directory = await realpath(await mkdtemp(join(lab, 'lease-heartbeat-')));
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  const binding = { integrationId: '11'.repeat(32), serviceId: '22'.repeat(32), workspace: 'd:/trial', serviceOrigin: 'http://127.0.0.1:42001' };
  const launchKey = '33'.repeat(32);
  const launch = { schemaVersion: 1 as const, kind: 'normal-gui-launch' as const, binding, launchKey,
    identityKey: '44'.repeat(32), privateDirectory: directory, authenticationProof: 'unused fixture' };
  const clock = new FakeClock();
  const view = new ViewProjection(new Registry(clock), clock, { isolationId: binding.integrationId, pluginVersion: '0.1.16', openCodeVersion: '2.0.31' }, undefined, undefined, undefined, undefined, '55'.repeat(32));
  const runtime = await startNormalPlugin({ launch } as Awaited<ReturnType<typeof prepareNormalPlugin>>,
    { verifyVersion: async () => '2.0.31', verifyCompatibility: async () => '2.0.31' }, view);
  const file = join(directory, `${binding.serviceId}.json`);
  try {
    t.mock.timers.tick(81000);
    let fresh = false;
    for (let i = 0; i < 100; i++) {
      try { verifyConnectionLease(JSON.parse(await readFile(file, 'utf8')), binding, launchKey, Date.now()); fresh = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(fresh, true, 'heartbeat must remain live when no supervisor/process tick is called');
    await runtime.close();
    t.mock.timers.tick(120000);
    await assert.rejects(readFile(file));
  } finally { await runtime.close(); t.mock.timers.reset(); await rm(directory, { recursive: true, force: true }); }
});
