import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalIdentityCodec } from '../src/normal-identity-protocol.ts';
import { NotificationIdentities, type NotificationIdentity } from '../src/notification-identities.ts';

test('signed durable notifications reuse the identity owner and survive connection key rotation', async () => {
  const integrationId = '11'.repeat(32), key = '22'.repeat(32);
  const identity: NotificationIdentity = { schemaVersion: 1, isolationId: integrationId, instanceId: 'old-instance',
    taskId: 'task_1', attemptId: 'attempt_1', parentSessionId: 'ses_A', childSessionId: 'ses_B',
    notificationId: 'notice_1', eventId: 'event_1', messageId: 'msg_1' };
  const codec = normalIdentityCodec(integrationId, key);
  const directory = await mkdtemp(join(tmpdir(), 'supervisor-signed-identities-'));
  try {
    const owner = await NotificationIdentities.load(directory, integrationId, codec);
    await owner.record(identity);
    await owner.record(identity);
    const text = await readFile(join(directory, 'msg_1.json'), 'utf8');
    assert.ok(!text.includes(key));
    assert.ok(!text.includes('isolationId'));
    const reloaded = await NotificationIdentities.load(directory, integrationId, normalIdentityCodec(integrationId, key));
    assert.deepEqual(reloaded.forParent('ses_A'), [identity]);
    assert.deepEqual(reloaded.forParent('ses_B'), []);
    const signed = JSON.parse(text);
    assert.throws(() => codec.decode({ ...signed, payload: { ...signed.payload, parentSessionId: 'ses_wrong' } }));
    assert.throws(() => codec.decode({ ...signed, payload: { ...signed.payload, isolationId: integrationId } }));
    assert.throws(() => normalIdentityCodec('33'.repeat(32), key).decode(signed));
    assert.throws(() => normalIdentityCodec(integrationId, '44'.repeat(32)).decode(signed));
    await assert.rejects(NotificationIdentities.load(directory, integrationId));
    await assert.rejects(NotificationIdentities.load(directory, integrationId, normalIdentityCodec(integrationId, '55'.repeat(32))));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
