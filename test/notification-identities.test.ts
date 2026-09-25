import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { NotificationIdentities, type NotificationIdentity } from '../src/notification-identities.ts';

const identity: NotificationIdentity = { schemaVersion: 1, isolationId: 'lab_A', instanceId: 'instance_A',
  taskId: 'task_A', attemptId: 'attempt_A', parentSessionId: 'ses_A', childSessionId: 'ses_childA',
  eventId: 'event_A', notificationId: 'notice_A', messageId: 'msg_A' };
async function cleanup(directory: string) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('supervisor-identities-'));
  await rm(target, { recursive: true });
}

test('durable identities reload exactly, isolate parents, deduplicate and reject conflicts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supervisor-identities-'));
  try {
    const ledger = await NotificationIdentities.load(directory, 'lab_A');
    await Promise.all([ledger.record(identity), ledger.record(identity)]);
    const loaded = await NotificationIdentities.load(directory, 'lab_A');
    assert.deepEqual(loaded.forParent('ses_A'), [identity]);
    assert.deepEqual(loaded.forParent('ses_B'), []);
    loaded.forParent('ses_A')[0]!.parentSessionId = 'ses_changed';
    assert.deepEqual(loaded.forParent('ses_A'), [identity]);
    await assert.rejects(loaded.record({ ...identity, parentSessionId: 'ses_B' }));
    await assert.rejects(loaded.record({ ...identity, messageId: 'msg_other' }));
    await assert.rejects(NotificationIdentities.load(directory, 'foreign_lab'));
  } finally { await cleanup(directory); }
});

test('torn or unexpected identity records block classification instead of being silently discarded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supervisor-identities-'));
  try {
    await writeFile(join(directory, 'msg_torn.json'), '{');
    await assert.rejects(NotificationIdentities.load(directory, 'lab_A'));
  } finally { await cleanup(directory); }
});
