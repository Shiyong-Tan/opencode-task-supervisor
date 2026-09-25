import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFrom, OpenCodeApi } from '../src/opencode-api.ts';

const message = (role: string, created: number, overrides = {}, parts: unknown[] = []) => ({
  info: { id: `m${created}`, sessionID: 'child', role, time: { created }, ...overrides }, parts,
});
test('idle is absence in status map, not missing session', () => {
  assert.equal(snapshotFrom('child', [], {}, []).status, 'idle');
});
test('final assistant completion requires recognized finish reason', () => {
  const msg = message('assistant', 2, { time: { created: 2, completed: 3 }, finish: 'stop' });
  assert.equal(snapshotFrom('child', [msg], {}, []).terminal, 'completed');
  assert.equal(snapshotFrom('child', [{ ...msg, info: { ...msg.info, finish: 'tool-calls' } }], {}, []).terminal, undefined);
  assert.equal(snapshotFrom('child', [msg, message('user', 4)], {}, []).terminal, undefined);
});
test('permissions filter session and running tools remain unresolved', () => {
  const msg = message('assistant', 1, {}, [{ type: 'tool', state: { status: 'running' } }]);
  const result = snapshotFrom('child', [msg], {}, [{ id: 'own', sessionID: 'child' }, { id: 'foreign', sessionID: 'parent' }]);
  assert.deepEqual(result.permissionIds, ['own']); assert.equal(result.pendingTools, 1);
  assert.equal(result.process, 'unknown');
});
test('empty assistant or user notification does not count as resumed parent output', () => {
  const result = snapshotFrom('child', [message('user', 1), message('assistant', 2)], {}, []);
  assert.equal(result.assistantActivity.length, 0);
});
test('assistant bookkeeping changes alone do not establish parent progress', () => {
  const parts = [{ type: 'text', text: 'existing output' }];
  const before = snapshotFrom('child', [message('assistant', 2, { cost: 0 }, parts)], {}, []);
  const after = snapshotFrom('child', [message('assistant', 2, { cost: 1 }, parts)], {}, []);
  assert.deepEqual(before.assistantActivity, after.assistantActivity);
});
test('unexpected response shapes and cross-session messages fail closed', () => {
  assert.throws(() => snapshotFrom('child', {}, {}, []));
  assert.throws(() => snapshotFrom('child', [], { child: { type: 'mystery' } }, []));
  assert.throws(() => snapshotFrom('foreign', [message('user', 1)], {}, []));
});
test('adapter refuses remote servers but does not gate a valid new version', async () => {
  assert.throws(() => new OpenCodeApi({ baseUrl: 'https://example.com', directory: '.' }));
  const api = new OpenCodeApi({ baseUrl: 'http://127.0.0.1', directory: '.',
    fetch: async () => new Response(JSON.stringify({ version: '2.0.0' })) });
  assert.equal(await api.verifyVersion(new AbortController().signal), '2.0.0');
});

test('compatibility probes required reads, accepts additive fields and performs no mutations', async () => {
  const calls: string[] = [];
  const responses: Record<string, unknown> = { '/global/health': { version: '2.9.0-next.1', healthy: true },
    '/session/status': { child: { type: 'busy', newField: true } }, '/permission': [] };
  const api = new OpenCodeApi({ baseUrl: 'http://127.0.0.1', directory: '.', fetch: async (url, init) => {
    assert.equal(init?.method, 'GET'); calls.push(new URL(String(url)).pathname);
    return Response.json(responses[calls.at(-1)!]);
  } });
  assert.equal(await api.verifyCompatibility(new AbortController().signal), '2.9.0-next.1');
  assert.deepEqual(calls.sort(), ['/global/health', '/permission', '/session/status']);
  responses['/session/status'] = { child: { type: 'renamed' } };
  await assert.rejects(api.verifyCompatibility(new AbortController().signal), /session\/status/);
  responses['/session/status'] = {};
  responses['/permission'] = [{ id: 'permission_without_session' }];
  await assert.rejects(api.verifyCompatibility(new AbortController().signal), /permission/);
});

test('required endpoint failures remain unavailable regardless of version', async () => {
  for (const status of [401, 404, 500]) {
    const api = new OpenCodeApi({ baseUrl: 'http://127.0.0.1', directory: '.', fetch: async url =>
      new URL(String(url)).pathname === '/global/health' ? Response.json({ version: '1.18.31' }) : new Response(null, { status }) });
    await assert.rejects(api.verifyCompatibility(new AbortController().signal), new RegExp(`HTTP ${status}`));
  }
});

test('unknown tool states and malformed metadata cannot be treated as completed', () => {
  const done = { time: { created: 1, completed: 2 }, finish: 'stop' };
  assert.throws(() => snapshotFrom('child', [message('assistant', 1, done, [{ type: 'tool', state: { status: 'new-pending-state' } }])], {}, []), /tool state/);
  assert.throws(() => snapshotFrom('child', [message('assistant', 1, { time: {} })], {}, []), /metadata/);
  assert.equal(snapshotFrom('child', [message('assistant', 1, { ...done, newMetadata: 'safe' }, [{ type: 'text', text: 'Done', newField: true }])], {}, []).terminal, 'completed');
});
