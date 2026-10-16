import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromV2 } from '../src/v2-observation.ts';

const message = (id: string, type: string, more = {}) => ({ id: `msg_${id}`, type, time: { created: 1 }, ...more });
const user = message('user', 'user', { text: 'Fixture' });
const assistant = (content: unknown[], more = {}) => message('assistant', 'assistant', { content, ...more });
const tool = (id: string, name: string, status = 'completed') => ({ type: 'tool', id, name, state: { status, input: {} } });
const idle = (outcome = 'succeeded') => message('idle', 'idle', { outcome });
const read = (messages: unknown[], active = {}, permissions: unknown[] = [], forms: unknown[] = []) => snapshotFromV2('ses_child', messages, active, permissions, forms);

test('provider completion alone does not finish a V2 execution', () => {
  const snapshot = read([user, assistant([{ type: 'text', text: 'Answer' }], { finish: 'stop', time: { created: 1, completed: 2 } })]);
  assert.equal(snapshot.terminal, undefined); assert.equal(snapshot.result, undefined);
});
test('explicit idle execution outcome yields a result only after all tool and interaction work ends', () => {
  const messages = [user, assistant([{ type: 'text', text: 'Answer' }]), idle()];
  assert.equal(read(messages).terminal, 'completed'); assert.equal(read(messages).result?.text, 'Answer');
  assert.equal(read(messages, { ses_child: { type: 'running' } }).terminal, undefined);
  assert.equal(read(messages, {}, [], [{ id: 'frm_pending', sessionID: 'ses_child' }]).terminal, undefined);
});
test('new user or assistant after an old idle record invalidates that terminal boundary', () => {
  assert.equal(read([idle(), user]).terminal, undefined);
  assert.equal(read([idle(), assistant([])]).terminal, undefined);
});
test('parallel tools keep message/call identity and independent pending states', () => {
  const snapshot = read([assistant([tool('A', 'read'), tool('B', 'read', 'running')]), idle()]);
  assert.equal(snapshot.pendingTools, 1); assert.equal(snapshot.terminal, undefined);
  assert.throws(() => read([assistant([tool('A', 'read'), tool('A', 'read')])]));
});
test('pending permission associates native source IDs and action/resources', () => {
  const permission = { id: 'per_pending', sessionID: 'ses_child', action: 'shell', resources: ['python --version'], source: { type: 'tool', messageID: 'msg_assistant', id: 'A' } };
  const snapshot = read([assistant([tool('A', 'shell', 'running')])], {}, [permission]);
  assert.deepEqual(snapshot.permissionIds, ['per_pending']);
  assert.equal(snapshot.permissions?.[0]?.state, 'pending'); assert.equal(snapshot.permissions?.[0]?.tool, 'shell');
  assert.deepEqual(snapshot.permissions?.[0]?.patterns, ['python --version']);
  assert.equal(read([assistant([tool('A', 'shell')]), idle()], {}, [permission]).permissions?.[0]?.state, 'expired');
});
test('unassociated permission remains unknown and cannot establish safe cancellation', () => {
  const snapshot = read([idle()], {}, [{ id: 'per_pending', sessionID: 'ses_child', action: 'shell', resources: [] }]);
  assert.equal(snapshot.permissions?.[0]?.state, 'unknown'); assert.equal(snapshot.terminal, undefined);
});
test('foreign interactions and duplicate transcript IDs are rejected', () => {
  assert.throws(() => read([], {}, [{ id: 'per_x', sessionID: 'ses_other', action: 'read', resources: [] }]));
  assert.throws(() => read([], {}, [], [{ id: 'frm_x', sessionID: 'global' }]));
  assert.throws(() => read([user, user]));
});
test('read-only tools exclude external process execution while native and supervised commands require separate proof', () => {
  assert.equal(read([assistant([tool('A', 'read')])]).executionStopConfirmed, true);
  for (const name of ['shell', 'subagent', 'future_tool', 'supervisor_run']) {
    const snapshot = read([assistant([tool('A', name)]), idle()]);
    assert.equal(snapshot.executionStopConfirmed, false); assert.equal(snapshot.process, 'unknown');
  }
});
test('polling and token bookkeeping changes do not create assistant output progress', () => {
  const content = [{ type: 'text', text: 'Existing' }];
  assert.deepEqual(read([assistant(content, { cost: 1 })]).assistantActivity,
    read([assistant(content, { cost: 2 })]).assistantActivity);
  assert.deepEqual(read([assistant([])]).assistantActivity, []);
});
test('unknown execution and tool state never silently becomes idle or successful', () => {
  assert.throws(() => read([], { ses_child: { type: 'future' } }));
  assert.throws(() => read([idle('future')]));
  assert.throws(() => read([assistant([tool('A', 'read', 'future')])]));
});
test('failed and interrupted executions are explicit non-success outcomes', () => {
  for (const outcome of ['failed', 'interrupted']) {
    const snapshot = read([assistant([{ type: 'text', text: 'Partial' }]), idle(outcome)]);
    assert.equal(snapshot.terminal, 'failed'); assert.equal(snapshot.result?.outcome, 'failed');
  }
});
