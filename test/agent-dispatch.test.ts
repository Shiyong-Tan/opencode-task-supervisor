import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareAgentDispatch } from '../src/agent-dispatch.ts';
import { OpenCodeApi } from '../src/opencode-api.ts';
import { Supervisor } from '../src/supervisor.ts';
import plugin from '../src/plugin.ts';
import type { ToolContext } from '@opencode-ai/plugin';
import { FakeClock, flush } from './helpers.ts';

function fixture() {
  const ownModel = { providerID: 'test', modelID: 'coder-model' };
  const responses: Record<string, unknown> = {
    '/global/health': { version: '1.18.31' },
    '/session/ses_child': { id: 'ses_child' },
    '/session/status': {},
    '/permission': [],
    '/session/ses_child/message': [{ info: { id: 'msg_final', sessionID: 'ses_child', role: 'assistant',
      time: { created: 1, completed: 2 }, finish: 'stop' }, parts: [{ type: 'text', text: 'Verified child result' }] }],
    '/agent': [
      { name: 'coder', mode: 'subagent', model: ownModel, permission: [{ permission: 'task', pattern: 'explorer', action: 'allow' }] },
      { name: 'verifier', mode: 'subagent', permission: [{ permission: 'edit', pattern: '*', action: 'deny' }] },
      { name: 'researcher', mode: 'primary', permission: [] },
    ],
    '/config': { experimental: { primary_tools: ['private_tool'] } },
    '/session/ses_parent': { id: 'ses_parent', permission: [
      { permission: 'edit', pattern: 'protected/*', action: 'deny' },
      { permission: 'external_directory', pattern: '/safe/*', action: 'ask' },
      { permission: 'bash', pattern: '*', action: 'allow' },
    ] },
    '/session/ses_parent/message/msg_parent': { info: { id: 'msg_parent', sessionID: 'ses_parent', role: 'assistant',
      agent: 'researcher', providerID: 'test', modelID: 'parent-model', variant: 'parent-variant' } },
  };
  const requests: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ path, method: init?.method ?? 'GET', body });
    if (path === '/session' && init?.method === 'POST') return Response.json({ id: 'ses_child', parentID: body?.parentID });
    if (path === '/session/ses_child/prompt_async') return new Response(null, { status: 204 });
    if (!(path in responses)) throw new Error(`Unexpected test HTTP ${path}`);
    return Response.json(responses[path]);
  };
  const api = new OpenCodeApi({ baseUrl: 'http://127.0.0.1:49999', directory: '.', fetch: fetcher,
    model: { providerID: 'test', modelID: 'legacy-override' } });
  const prepare = (agent = 'coder') => prepareAgentDispatch(api, 'ses_parent', 'msg_parent', 'researcher', agent, new AbortController().signal);
  return { api, prepare, responses, requests, fetcher, ownModel };
}

test('named HTTP dispatch selects real role/model and inherits restrictive session rules', async () => {
  const f = fixture();
  const selection = await f.prepare();
  assert.equal(selection.agent, 'coder');
  assert.deepEqual(selection.model, f.ownModel);
  assert.equal(selection.variant, undefined);
  assert.deepEqual(selection.permission, [
    { permission: 'edit', pattern: 'protected/*', action: 'deny' },
    { permission: 'external_directory', pattern: '/safe/*', action: 'ask' },
    { permission: 'todowrite', pattern: '*', action: 'deny' },
    { permission: 'private_tool', pattern: '*', action: 'deny' },
    { permission: 'supervisor_dispatch', pattern: '*', action: 'deny' },
  ]);
  const signal = new AbortController().signal;
  const child = await f.api.create('ses_parent', 'role task', signal, selection);
  await f.api.dispatch(child, 'Implement the bounded assignment', signal, selection);
  const writes = f.requests.filter(r => r.method === 'POST');
  assert.equal(writes[0]!.body!.agent, 'coder');
  assert.deepEqual(writes[0]!.body!.permission, selection.permission);
  assert.deepEqual(writes[1]!.body, { parts: [{ type: 'text', text: 'Implement the bounded assignment' }], agent: 'coder', model: f.ownModel });
});

test('role without a model inherits the actual caller model and variant, not plugin override', async () => {
  const selection = await fixture().prepare('verifier');
  assert.deepEqual(selection.model, { providerID: 'test', modelID: 'parent-model' });
  assert.equal(selection.variant, 'parent-variant');
  assert.ok(selection.permission.some(r => r.permission === 'task' && r.action === 'deny'));
});

for (const agent of ['missing', 'researcher', ' coder', '']) {
  test(`invalid/non-subagent role creates no child: ${JSON.stringify(agent)}`, async () => {
    const f = fixture(); await assert.rejects(f.prepare(agent));
    assert.ok(f.requests.every(r => r.method === 'GET'));
  });
}

test('depth, malformed permissions and caller identity failures are rejected before writes', async () => {
  for (const replacement of [
    { path: '/session/ses_parent', value: { id: 'ses_parent', parentID: 'ses_grandparent' } },
    { path: '/session/ses_parent', value: { id: 'ses_foreign' } },
    { path: '/session/ses_parent', value: { id: 'ses_parent', permission: [{ permission: '*', pattern: '*', action: 'invalid' }] } },
    { path: '/session/ses_parent/message/msg_parent', value: { info: { id: 'msg_foreign', sessionID: 'ses_parent', role: 'assistant', agent: 'researcher' } } },
    { path: '/config', value: { subagent_depth: '2' } },
  ]) {
    const f = fixture(); f.responses[replacement.path] = replacement.value;
    await assert.rejects(f.prepare()); assert.ok(f.requests.every(r => r.method === 'GET'));
  }
});

test('permitted ancestry is checked and cyclic ancestry is rejected', async () => {
  const f = fixture(); f.responses['/config'] = { subagent_depth: 3 };
  f.responses['/session/ses_parent'] = { id: 'ses_parent', parentID: 'ses_grandparent' };
  f.responses['/session/ses_grandparent'] = { id: 'ses_grandparent' };
  assert.equal((await f.prepare()).agent, 'coder');
  f.responses['/session/ses_grandparent'] = { id: 'ses_grandparent', parentID: 'ses_parent' };
  await assert.rejects(f.prepare(), /Cyclic/);
});

test('task owner captures selection, refuses role changes and never duplicates a dispatch', async () => {
  const f = fixture(); const clock = new FakeClock(); const owner = new Supervisor(f.api, clock);
  const selection = await f.prepare(); const task = owner.register('ses_parent');
  const report = owner.dispatch(task.taskId, 'ses_parent', 'task', selection);
  assert.equal(report.agent, 'coder'); selection.model.modelID = 'mutated';
  owner.dispatch(task.taskId, 'ses_parent', 'duplicate', selection);
  assert.throws(() => owner.dispatch(task.taskId, 'ses_parent', 'change', { ...selection, agent: 'verifier' }), /cannot change/);
  assert.throws(() => owner.dispatch(task.taskId, 'ses_foreign', 'foreign', selection), /not owned/);
  await owner.settledDispatches();
  const prompts = f.requests.filter(r => r.path.endsWith('/prompt_async'));
  assert.equal(prompts.length, 1); assert.deepEqual(prompts[0]!.body!.model, f.ownModel);
});

// Exercise the actual exported plugin tool; no service, model or credentials used.
test('plugin enforces native task permission before named dispatch and keeps retries idempotent', async () => {
  const f = fixture(); const originalFetch = globalThis.fetch; globalThis.fetch = f.fetcher;
  const hooks = await plugin({ serverUrl: new URL('http://127.0.0.1:49999'), directory: '.' } as Parameters<typeof plugin>[0], { allowDispatch: true, allowNotifications: true });
  let deny = true; const asks: string[][] = [];
  const ctx: ToolContext = { sessionID: 'ses_parent', messageID: 'msg_parent', agent: 'researcher', directory: '.', worktree: '.',
    abort: new AbortController().signal, metadata() {}, async ask(input) {
      assert.equal(input.permission, 'task'); asks.push(input.patterns);
      if (deny) throw new Error('Role denied');
    } };
  try {
    const task = JSON.parse(String(await hooks.tool!.supervisor_register!.execute({}, ctx))) as { taskId: string };
    const dispatch = hooks.tool!.supervisor_dispatch!;
    assert.ok(dispatch.args.agent);
    await assert.rejects(dispatch.execute({ taskId: task.taskId, prompt: 'task', agent: 'coder' }, ctx), /Role denied/);
    assert.ok(f.requests.every(r => r.method === 'GET'));
    deny = false;
    const result = JSON.parse(String(await dispatch.execute({ taskId: task.taskId, prompt: 'task', agent: 'coder' }, ctx)));
    assert.equal(result.agent, 'coder');
    assert.equal(result.delivery, 'inline');
    assert.equal(result.event, 'completed');
    assert.equal(result.result.text, 'Verified child result');
    assert.ok(!result.next.includes('End this turn'));
    assert.ok(dispatch.args.waitMs);
    assert.ok(hooks.tool!.supervisor_cancel);
    const waited = JSON.parse(String(await hooks.tool!.supervisor_wait!.execute({ taskId: task.taskId, waitMs: 1000 }, ctx)));
    assert.equal(waited.result.text, 'Verified child result');
    await assert.rejects(hooks.tool!.supervisor_cancel!.execute({ taskId: task.taskId }, { ...ctx, sessionID: 'ses_foreign' }), /not owned/);
    assert.equal(f.requests.filter(r => r.path === '/session/ses_parent/prompt_async').length, 0);
    await flush();
    await dispatch.execute({ taskId: task.taskId, prompt: 'duplicate', agent: 'coder' }, ctx);
    assert.deepEqual(asks, [['coder'], ['coder']]);
    assert.equal(f.requests.filter(r => r.path.endsWith('/prompt_async')).length, 1);
    await assert.rejects(dispatch.execute({ taskId: task.taskId, prompt: 'change', agent: 'verifier' }, ctx), /cannot change/);
  } finally { await hooks.dispose?.(); globalThis.fetch = originalFetch; }
});

test('disabled dispatch, foreign task and cancellation cannot create a child', async () => {
  const f = fixture(); const originalFetch = globalThis.fetch; globalThis.fetch = f.fetcher;
  const input = { serverUrl: new URL('http://127.0.0.1:49999'), directory: '.' } as Parameters<typeof plugin>[0];
  const disabled = await plugin(input, {});
  const hooks = await plugin(input, { allowDispatch: true });
  const controller = new AbortController();
  const ctx: ToolContext = { sessionID: 'ses_parent', messageID: 'msg_parent', agent: 'researcher', directory: '.', worktree: '.',
    abort: controller.signal, metadata() {}, async ask() { controller.abort(); } };
  try {
    const task = JSON.parse(String(await hooks.tool!.supervisor_register!.execute({}, ctx)));
    const args = { taskId: task.taskId, prompt: 'task', agent: 'coder' };
    await assert.rejects(disabled.tool!.supervisor_dispatch!.execute(args, ctx), /Dispatch disabled/);
    await assert.rejects(hooks.tool!.supervisor_dispatch!.execute(args, { ...ctx, sessionID: 'ses_foreign' }), /not owned/);
    assert.equal(f.requests.length, 0);
    await assert.rejects(hooks.tool!.supervisor_dispatch!.execute(args, ctx), /aborted/);
    assert.ok(f.requests.every(r => r.method === 'GET'));
    const status = JSON.parse(String(await hooks.tool!.supervisor_status!.execute({ taskId: task.taskId }, ctx)));
    assert.equal(status.phase, 'registered'); assert.equal(status.childSessionId, undefined);
  } finally { await hooks.dispose?.(); await disabled.dispose?.(); globalThis.fetch = originalFetch; }
});
