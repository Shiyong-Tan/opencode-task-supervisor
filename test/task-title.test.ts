import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskTitle } from '../src/task-title.ts';
import { Supervisor } from '../src/supervisor.ts';
import { FakeApi, FakeClock } from './helpers.ts';

test('titles use readable descriptions and preserve the native role suffix', () => {
  assert.equal(taskTitle('检查残留重建进程', 'coder'), '检查残留重建进程 (@coder subagent)');
  assert.equal(taskTitle('  Verify\n output\t files\0 ', 'verifier'), 'Verify output files (@verifier subagent)');
  assert.equal(taskTitle(undefined, 'coder'), 'Supervised task (@coder subagent)');
  assert.equal(taskTitle('   '), 'Supervised task');
  const long = taskTitle('😀'.repeat(121));
  assert.equal(Array.from(long).length, 120); assert.ok(long.endsWith('…'));
});

test('session creation receives the display title without changing canonical identity or renaming on duplicate dispatch', async () => {
  let createdTitle = '';
  const api = new FakeApi();
  const create = api.create.bind(api);
  const transport = { create: async (_parent: string, title: string) => { createdTitle = title; return create(); },
    dispatch: api.dispatch.bind(api), observe: api.observe.bind(api), abort: api.abort.bind(api), notify: api.notify.bind(api) };
  const owner = new Supervisor(transport, new FakeClock());
  const task = owner.register('parent');
  owner.dispatch(task.taskId, 'parent', 'Private full assignment', undefined, 'inline', 'Check R1 status');
  owner.dispatch(task.taskId, 'parent', 'Duplicate', undefined, 'inline', 'Wrong replacement name');
  await owner.settledDispatches();
  assert.equal(createdTitle, 'Check R1 status');
  const current = owner.status(task.taskId, 'parent');
  assert.equal(current.title, createdTitle); assert.equal(current.taskId, task.taskId); assert.equal(current.attemptId, task.attemptId);
  assert.equal(api.creates, 1); assert.equal(api.dispatches, 1);
  assert.ok(!createdTitle.includes(task.taskId)); assert.ok(!createdTitle.includes('Private'));
});
