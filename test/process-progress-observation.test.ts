import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromV2 } from '../src/v2-observation.ts';
import { snapshotFrom } from '../src/opencode-api.ts';

test('process display ticks are not progress in either protocol; tool results and other metadata still are', () => {
  for (const native of [false, true]) {
    const read = (title: string, status = 'running', metadata = {}) => {
      const part = { type: 'tool', ...(native ? { id: 'call_A', name: 'supervisor_process_wait' } : { callID: 'call_A', tool: 'supervisor_process_wait' }),
        state: { status, input: { executionId: 'exec_A' }, ...(native ? { metadata: { ...metadata, title } } : { metadata, title }) } };
      return native ? snapshotFromV2('ses_child', [{ id: 'msg_A', type: 'assistant', time: { created: 1 }, content: [part] }],
        { ses_child: { type: 'running' } }, [], []) : snapshotFrom('ses_child', [{ info: { id: 'msg_A', sessionID: 'ses_child', role: 'assistant',
          time: { created: 1 } }, parts: [part] }], { ses_child: { type: 'busy' } }, []);
    };
    const before = read('Elapsed 1m 1s'), tick = read('Elapsed 1m 2s');
    assert.deepEqual(tick.activity, before.activity);
    assert.deepEqual(tick.assistantActivity, before.assistantActivity);
    assert.notDeepEqual(read('Elapsed 1m 2s', 'completed').assistantActivity, before.assistantActivity);
    assert.notDeepEqual(read('Elapsed 1m 2s', 'running', { evidence: 'new' }).assistantActivity, before.assistantActivity);
  }
});
