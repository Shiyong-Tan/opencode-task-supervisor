import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFrom } from '../src/opencode-api.ts';
import { Registry, report } from '../src/registry.ts';
import { FakeClock } from './helpers.ts';

const permission = { id: 'per_a', sessionID: 'ses_child', permission: 'external_directory', patterns: ['D:/fixture/*'],
  tool: { messageID: 'msg_a', callID: 'call_a' } };
const message = (status: string, aborted = false) => [{ info: { id: 'msg_a', sessionID: 'ses_child', role: 'assistant',
  time: { created: 1, ...(aborted ? { completed: 2 } : {}) }, ...(aborted ? { error: { name: 'MessageAbortedError' } } : {}) },
  parts: [{ type: 'tool', tool: 'read', callID: 'call_a', state: { status, input: { filePath: 'D:/fixture/read.txt' } } }] }];

test('waiting permission includes exact owner, request, tool and scope without tool output', () => {
  const observed = snapshotFrom('ses_child', message('running'), { ses_child: { type: 'busy' } }, [permission]);
  assert.deepEqual(observed.permissionIds, ['per_a']);
  assert.deepEqual(observed.permissions![0], { requestId: 'per_a', sessionId: 'ses_child', permission: 'external_directory',
    patterns: ['D:/fixture/*'], messageId: 'msg_a', callId: 'call_a', tool: 'read', input: '{"filePath":"D:/fixture/read.txt"}', state: 'pending' });
  const registry = new Registry(new FakeClock()), task = registry.register('ses_parent'); task.phase = 'dispatching'; registry.attach(task, 'ses_child');
  registry.apply(task, observed); assert.equal(report(task).health, 'waiting_permission'); assert.equal(report(task).permissions![0]!.requestId, 'per_a');
  registry.queryFailed(task, 'offline'); assert.equal(report(task).permissionObservation, 'unavailable'); assert.equal(task.health, 'unreachable');
});

test('aborted tool residual requests are expired; idle alone cannot expire a live permission', () => {
  const live = snapshotFrom('ses_child', message('running'), {}, [permission]);
  assert.deepEqual(live.permissionIds, ['per_a']);
  const aborted = snapshotFrom('ses_child', message('error', true), {}, [permission]);
  assert.deepEqual(aborted.permissionIds, []); assert.equal(aborted.permissions![0]!.state, 'expired');
  const registry = new Registry(new FakeClock()), task = registry.register('ses_parent'); task.phase = 'dispatching'; registry.attach(task, 'ses_child');
  task.cancellation = 'acknowledged'; registry.apply(task, aborted);
  assert.equal(task.health, 'cancel_unknown'); assert.equal(task.process, 'unknown'); assert.notEqual(task.phase, 'terminal');
  assert.equal(report(task).permissions![0]!.state, 'expired');
});

test('unmatched permission tools remain unknown instead of inventing cancellation or completion', () => {
  const observed = snapshotFrom('ses_child', message('completed'), {}, [{ ...permission, tool: { messageID: 'msg_other', callID: 'call_a' } }]);
  assert.equal(observed.permissions![0]!.state, 'unknown'); assert.deepEqual(observed.permissionIds, ['per_a']);
});


test('pending questions report waiting_question instead of a stall, and aborted residuals expire', () => {
  const clock = new FakeClock(), registry = new Registry(clock, 1), task = registry.register('ses_parent');
  task.phase = 'dispatching'; registry.attach(task, 'ses_child');
  const request = { id: 'que_a', sessionID: 'ses_child', tool: { messageID: 'msg_a', callID: 'call_a' } };
  const live = snapshotFrom('ses_child', message('running'), {}, [], [request]);
  registry.apply(task, live);
  assert.equal(task.health, 'waiting_question'); assert.deepEqual(task.questionIds, ['que_a']);
  const ended = snapshotFrom('ses_child', message('error', true), {}, [], [request]);
  assert.deepEqual(ended.questionIds, []);
  registry.apply(task, ended); assert.notEqual(task.health, 'waiting_question');
});
