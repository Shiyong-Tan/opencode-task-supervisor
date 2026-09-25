import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeApi } from '../src/opencode-api.ts';
import { parseOpenCodeVersion } from '../src/opencode-version.ts';
import { Registry } from '../src/registry.ts';
import { ViewProjection } from '../src/view-projection.ts';
import { parseSupervisorView } from '../src/view-protocol.ts';
import { FakeClock } from './helpers.ts';

for (const version of ['1.18.29', '1.18.31', '1.18.32', '2.0.0', '1.18.31-beta', '2.0.0-dev.1+build.8'] as const) {
  test(`health and snapshot retain actual OpenCode ${version}`, async () => {
    const api = new OpenCodeApi({ baseUrl: 'http://127.0.0.1', directory: '.',
      fetch: async () => Response.json({ version }) });
    const actual = await api.verifyVersion(new AbortController().signal);
    assert.equal(actual, version);
    const clock = new FakeClock();
    const view = new ViewProjection(new Registry(clock), clock,
      { pluginVersion: '0.1.0', openCodeVersion: actual, isolationId: 'test' });
    assert.equal(parseSupervisorView(view.snapshot('ses_test')).openCodeVersion, version);
  });
}

for (const version of ['', 'bad label', null, 11831, {}, undefined]) {
  test(`reject malformed health version ${JSON.stringify(version)}`, async () => {
    const api = new OpenCodeApi({ baseUrl: 'http://127.0.0.1', directory: '.', fetch: async () => Response.json({ version }) });
    await assert.rejects(api.verifyVersion(new AbortController().signal), /Invalid OpenCode health version label/);
  });
}

test('version diagnostics never reflect arbitrary service content', () => {
  assert.throws(() => parseOpenCodeVersion('secret-token'), /Invalid OpenCode health version label/);
});
