import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionTodos } from '../src/todos.ts';
import { parseTodoState } from '../src/todo-protocol.ts';

test('todo owner persists session-isolated state, serializes conflicting writes and supports explicit clearing', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-todos-')));
  try {
    const store = await SessionTodos.create(root);
    const item = { id: 'audit', content: 'Audit results', status: 'pending', priority: 'high' };
    assert.equal((await store.read('ses_A')).revision, 0);
    await store.write('ses_A', 0, [item]);
    const restarted = await SessionTodos.create(root);
    assert.deepEqual((await restarted.read('ses_A')).items, [item]);
    assert.deepEqual((await store.read('ses_B')).items, []);
    const results = await Promise.allSettled([store.write('ses_A', 1, [{ ...item, status: 'in_progress' }]), store.write('ses_A', 1, [])]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    await assert.rejects(store.write('ses_A', 0, []), /revision conflict/);
    assert.equal((await store.write('ses_A', 2, [])).revision, 3);
    assert.deepEqual((await (await SessionTodos.create(root)).read('ses_A')).items, []);
    assert.throws(() => store.read('../escape'));
    assert.throws(() => store.write('ses_A', 3, [item, item]));
    await writeFile(join(root, 'todos', 'ses_bad.json'), '{broken');
    await assert.rejects(store.read('ses_bad'));
    await writeFile(join(root, 'todos', 'ses_foreign.json'), JSON.stringify({ sessionId: 'ses_A', revision: 1, items: [] }));
    await assert.rejects(store.read('ses_foreign'), /Foreign/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('todo protocol bounds untrusted content and strips unknown metadata', () => {
  assert.deepEqual(parseTodoState({ sessionId: 'ses_A', revision: 0, items: [], secret: 'drop' }), { sessionId: 'ses_A', revision: 0, items: [] });
  for (const items of [Array(65).fill({}), [{ id: 'x', content: 'x'.repeat(501), status: 'pending', priority: 'high' }]])
    assert.throws(() => parseTodoState({ sessionId: 'ses_A', revision: 0, items }));
});
