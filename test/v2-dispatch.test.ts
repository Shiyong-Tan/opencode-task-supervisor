import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeV2Api } from '../src/opencode-v2-api.ts';
import type { AgentDispatch } from '../src/agent-dispatch.ts';

const signal = () => new AbortController().signal;
const selected: AgentDispatch = { agent: 'reviewer', model: { providerID: 'provider', modelID: 'model' }, variant: 'high',
  permission: [{ permission: 'shell', pattern: 'danger*', action: 'deny' }] };
function harness(reply: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const api = new OpenCodeV2Api({ baseUrl: 'http://127.0.0.1:42000', directory: '/fixture', authorization: 'Basic fixture', isCurrent: () => true,
    fetch: async (value, init) => { const url = new URL(String(value)); calls.push({ path: url.pathname + url.search, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : undefined }); return reply(url, init || {}); } });
  return { api, calls };
}
test('native child creation retains role model variant and ordered deny rules', async () => {
  const f = harness(() => Response.json({ data: { id: 'ses_child', parentID: 'ses_parent' } }));
  assert.equal(await f.api.create('ses_parent', 'Review', signal(), selected), 'ses_child');
  assert.deepEqual(f.calls[0]?.body, { parentID: 'ses_parent', title: 'Review', location: { directory: '/fixture' }, agent: 'reviewer',
    model: { providerID: 'provider', id: 'model', variant: 'high' }, permissions: [{ action: 'shell', resource: 'danger*', effect: 'deny' }] });
});
test('dispatch admits one fixed ID and never retries an uncertain server response', async () => {
  const f = harness((_url, init) => {
    const body = JSON.parse(String(init.body)); return Response.json({ data: { id: body.id, sessionID: 'ses_child', type: 'user', delivery: 'steer' } });
  });
  await f.api.dispatch('ses_child', 'Fixture', signal()); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]?.path, '/api/session/ses_child/prompt');
  const broken = harness(() => new Response(null, { status: 500 }));
  await assert.rejects(broken.api.dispatch('ses_child', 'Fixture', signal())); assert.equal(broken.calls.length, 1);
});
test('interrupt acknowledgement never becomes proof that external processes stopped', async () => {
  for (const interrupted of [true, false]) {
    const f = harness(() => Response.json({ interrupted })); await f.api.abort('ses_child', signal());
    assert.equal(f.calls[0]?.path, '/api/session/ses_child/interrupt?resume=false');
  }
  await assert.rejects(harness(() => new Response(null, { status: 204 })).api.abort('ses_child', signal()));
});
test('explicit permission uses original session and call identity; rejection blocks execution', async () => {
  const ctx = { sessionID: 'ses_child', messageID: 'msg_assistant', id: 'call_A', agent: 'reviewer', signal: signal() };
  const f = harness(() => Response.json({ data: { id: 'per_fixture', effect: 'deny' } }));
  await assert.rejects(f.api.ask(ctx, 'supervisor_run', ['exact-command']));
  assert.deepEqual(f.calls[0]?.body, { action: 'supervisor_run', resources: ['exact-command'], save: [], metadata: {}, agent: 'reviewer',
    source: { type: 'tool', messageID: 'msg_assistant', id: 'call_A' } });
});
test('native role preparation verifies caller, catalog, inherited deny rules and model variant', async () => {
  const f = harness(url => {
    if (url.pathname === '/api/agent') return Response.json({ data: [{ id: 'reviewer', mode: 'subagent', permissions: [], model: { providerID: 'provider', id: 'model', variant: 'high' } }] });
    if (url.pathname === '/api/model') return Response.json({ data: [{ providerID: 'provider', id: 'model', enabled: true, variants: [{ id: 'high' }] }] });
    if (url.pathname === '/api/config') return Response.json([{ type: 'document', info: { experimental: { subagent_depth: 1 } } }]);
    if (url.pathname.endsWith('/message')) return Response.json({ data: [{ id: 'msg_caller', type: 'assistant', agent: 'researcher', model: { providerID: 'provider', id: 'parent-model' } }], cursor: {} });
    return Response.json({ data: { id: 'ses_parent', location: { directory: '/fixture' }, permissions: [{ action: 'shell', resource: 'danger*', effect: 'deny' }] } });
  });
  const result = await f.api.prepare('ses_parent', 'msg_caller', 'researcher', 'reviewer', signal());
  assert.equal(result.model.modelID, 'model'); assert.equal(result.variant, 'high');
  assert.ok(result.permission.some(rule => rule.permission === 'shell' && rule.action === 'deny'));
  assert.ok(result.permission.some(rule => rule.permission === 'supervisor_dispatch' && rule.action === 'deny'));
  assert.ok(f.calls.every(call => call.method === 'GET'));
  await assert.rejects(f.api.prepare('ses_parent', 'msg_caller', 'imposter', 'reviewer', signal()));
});
