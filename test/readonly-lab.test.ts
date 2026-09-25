import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { prepareReadonlyLab, startReadonlyLab } from '../src/readonly-lab.ts';
import { ViewProjection } from '../src/view-projection.ts';
import { Registry } from '../src/registry.ts';
import { OpenCodeApi } from '../src/opencode-api.ts';
import { FakeClock } from './helpers.ts';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'supervisor-readonly-lab-'));
  for (const part of ['home', 'config', 'data', 'cache', 'state', 'tmp', 'work']) await mkdir(join(root, part));
  await writeFile(join(root, 'isolation.json'), JSON.stringify({ schemaVersion: 1, isolationId: 'lab_A' }));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, name] of Object.entries({ HOME: 'home', USERPROFILE: 'home', OPENCODE_TEST_HOME: 'home',
    XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state',
    APPDATA: 'config', LOCALAPPDATA: 'data', TEMP: 'tmp', TMP: 'tmp' })) env[key] = join(root, name);
  Object.assign(env, { OPENCODE_DB: join(root, 'data', 'opencode.db'), OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1' });
  return { root, env, option: { enabled: true, root, isolationId: 'lab_A' }, directory: join(root, 'work'),
    async cleanup() {
      const target = resolve(root);
      assert.equal(dirname(target), resolve(tmpdir()));
      assert.ok(basename(target).startsWith('supervisor-readonly-lab-'));
      await rm(target, { recursive: true });
    } };
}

test('laboratory rejects missing isolation flags and mismatched environment without production fallback', async () => {
  const fixture = await setup();
  try {
    await assert.rejects(prepareReadonlyLab({ ...fixture.option, enabled: false }, fixture.directory, fixture.env));
    await assert.rejects(prepareReadonlyLab(fixture.option, fixture.root, fixture.env));
    await assert.rejects(prepareReadonlyLab(fixture.option, fixture.directory, { ...fixture.env, OPENCODE_DISABLE_PROJECT_CONFIG: '0' }));
    await assert.rejects(prepareReadonlyLab(fixture.option, fixture.directory, { ...fixture.env, XDG_DATA_HOME: fixture.root }));
    await assert.rejects(prepareReadonlyLab({ ...fixture.option, isolationId: 'foreign' }, fixture.directory, fixture.env));
  } finally { await fixture.cleanup(); }
});

test('descriptor lifecycle is exclusive and scoped; mismatched mocked service cannot start a bridge', async () => {
  const fixture = await setup();
  let runtime: Awaited<ReturnType<typeof startReadonlyLab>> | undefined;
  try {
    const lab = await prepareReadonlyLab(fixture.option, fixture.directory, fixture.env);
    const clock = new FakeClock();
    const projection = new ViewProjection(new Registry(clock), clock, { pluginVersion: '0.1.0', openCodeVersion: '1.18.29', isolationId: 'lab_A' });
    let version = '1.18.32';
    const api = new OpenCodeApi({ baseUrl: 'http://127.0.0.1:39999', directory: fixture.directory,
      headers: { authorization: 'Basic test-only' }, fetch: async url => Response.json(new URL(String(url)).pathname === '/global/health' ? { version } : new URL(String(url)).pathname === '/permission' ? [] : {}) });
    await assert.rejects(startReadonlyLab(lab, api, projection));
    const descriptorPath = join(lab.state, 'connection.json');
    await assert.rejects(access(descriptorPath));
    version = '1.18.29';
    runtime = await startReadonlyLab(lab, api, projection);
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
    assert.equal(descriptor.instanceId, projection.instanceId);
    assert.equal(descriptor.bridge.token.length, 64);
    await assert.rejects(startReadonlyLab(lab, api, projection));
    await runtime.close(); await runtime.close();
    await assert.rejects(access(descriptorPath));
    await assert.rejects(fetch(descriptor.bridge.endpoint));
    // Normal close permits a fresh instance. Historical task ownership is not restored.
    const fresh = new ViewProjection(new Registry(clock), clock, { pluginVersion: '0.1.0', openCodeVersion: '1.18.29', isolationId: 'lab_A' });
    runtime = await startReadonlyLab(lab, api, fresh);
    assert.notEqual(fresh.instanceId, projection.instanceId);
  } finally { await runtime?.close(); await fixture.cleanup(); }
});
