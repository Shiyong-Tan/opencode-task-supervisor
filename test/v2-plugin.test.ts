import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import plugin from '../src/plugin-v2.ts';
import legacyPlugin from '../src/plugin.ts';
import { canonicalWorkspace, serviceAuthenticationProof } from '../src/normal-connection-protocol.ts';

test('package server subpath supports the modern 1.x server loader and native 2.x setup loader', () => {
  assert.equal(plugin.server, legacyPlugin);
  assert.equal(typeof plugin.setup, 'function');
});

test('V2 entrypoint registers native tools and keeps dispatch disabled without explicit authorization', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-native-entry-')));
  const privateDirectory = join(root, 'private'); await mkdir(privateDirectory);
  const keys = ['OPENCODE_GUI_SUPERVISOR_BINDING', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_SERVER_USERNAME'];
  const previous = keys.map(key => process.env[key]); let cleanup: (() => Promise<void>) | undefined;
  const tools: { name: string; input: unknown; execute(input: unknown, ctx: { sessionID: string; messageID: string; id: string; agent: string; signal: AbortSignal; progress(value: Record<string, unknown>): Promise<void> }): Promise<{ content: string }> }[] = [];
  try {
    const password = randomBytes(32).toString('hex'), launchKey = randomBytes(32).toString('hex');
    process.env.OPENCODE_SERVER_PASSWORD = password; process.env.OPENCODE_SERVER_USERNAME = 'opencode';
    const binding = { integrationId: randomBytes(32).toString('hex'), serviceId: randomBytes(32).toString('hex'), workspace: canonicalWorkspace(root), serviceOrigin: 'http://127.0.0.1:42000' };
    process.env.OPENCODE_GUI_SUPERVISOR_BINDING = JSON.stringify({ schemaVersion: 1, kind: 'normal-gui-launch', binding, launchKey,
      identityKey: randomBytes(32).toString('hex'), privateDirectory,
      authenticationProof: serviceAuthenticationProof(launchKey, binding, 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')) });
    const dispose = async () => {};
    cleanup = await plugin.setup({ app: { version: '2.0.24' }, location: { directory: root }, options: { allowDispatch: false, normalGui: { enabled: true } },
      tool: { transform: async callback => { callback({ add: value => tools.push(value) }); return { dispose }; } } });
    assert.equal(process.env.OPENCODE_GUI_SUPERVISOR_BINDING, undefined);
    assert.ok(['supervisor_register', 'supervisor_dispatch', 'supervisor_status', 'supervisor_result', 'supervisor_wait', 'supervisor_cancel'].every(name => tools.some(tool => tool.name === name)));
    const ctx = { sessionID: 'ses_parent', messageID: 'msg_parent', id: 'call_A', agent: 'researcher', signal: new AbortController().signal, progress: async () => {} };
    const registered = JSON.parse((await tools.find(tool => tool.name === 'supervisor_register')!.execute({}, ctx)).content);
    assert.equal(registered.phase, 'registered');
    const readTodos = tools.find(tool => tool.name === 'supervisor_todo_read')!;
    assert.ok(tools.some(tool => tool.name === 'supervisor_todo_write'));
    assert.deepEqual(JSON.parse((await readTodos.execute({}, ctx)).content), { sessionId: 'ses_parent', revision: 0, items: [] });
    const writeTodos = tools.find(tool => tool.name === 'supervisor_todo_write')!;
    const originalFetch = globalThis.fetch;
    let effect = 'deny';
    const permissionRequests: Record<string, unknown>[] = [];
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).includes('/api/session/ses_parent/permission'));
      permissionRequests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: { effect } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const input = { expectedRevision: 0, items: [{ id: 'audit', content: 'Audit results', status: 'pending', priority: 'high' }] };
      await assert.rejects(writeTodos.execute(input, ctx), /Permission rejected/);
      assert.equal(JSON.parse((await readTodos.execute({}, ctx)).content).revision, 0);
      effect = 'allow';
      const written = JSON.parse((await writeTodos.execute(input, ctx)).content);
      assert.equal(written.revision, 1);
      assert.equal(JSON.parse((await readTodos.execute({}, { ...ctx, sessionID: 'ses_child' })).content).revision, 0);
      assert.equal(permissionRequests[0]!.action, 'todowrite');
    } finally { globalThis.fetch = originalFetch; }
    await assert.rejects(tools.find(tool => tool.name === 'supervisor_dispatch')!.execute({ taskId: registered.taskId, prompt: 'Fixture', agent: 'reviewer' }, ctx), /Dispatch disabled/);
    const aliasTools: typeof tools = [];
    const aliasDirectory = process.platform === 'win32' ? root[0].toLowerCase() + root.slice(1) : root;
    const aliasCleanup = await plugin.setup({ app: { version: '2.0.24' }, location: { directory: aliasDirectory },
      options: { allowDispatch: false, normalGui: { enabled: true } },
      tool: { transform: async callback => { callback({ add: value => aliasTools.push(value) }); return { dispose }; } } });
    try {
      const status = aliasTools.find(tool => tool.name === 'supervisor_result')!;
      const aliasRead = aliasTools.find(tool => tool.name === 'supervisor_todo_read')!;
      assert.equal(JSON.parse((await aliasRead.execute({}, ctx)).content).revision, 1);
      assert.equal(JSON.parse((await status.execute({ taskId: registered.taskId }, ctx)).content).taskId, registered.taskId);
      await cleanup(); cleanup = undefined;
      assert.equal(JSON.parse((await status.execute({ taskId: registered.taskId }, ctx)).content).taskId, registered.taskId);
    } finally { await aliasCleanup(); }
    const context = { app: { version: '2.0.24' }, location: { directory: root }, options: { allowDispatch: false, normalGui: { enabled: true } },
      tool: { transform: async () => ({ dispose }) } };
    cleanup = await plugin.setup(context);
    assert.equal(process.env.OPENCODE_GUI_SUPERVISOR_BINDING, undefined);
    const foreign = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-foreign-entry-')));
    try { await assert.rejects(plugin.setup({ ...context, location: { directory: foreign } })); }
    finally { await rm(foreign, { recursive: true, force: true }); }
  } finally {
    await cleanup?.(); keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    await rm(root, { recursive: true, force: true });
  }
});
