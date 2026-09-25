import { open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { parseNotificationIdentity, type NotificationIdentity } from './notification-identity-protocol.ts';
export { parseNotificationIdentity, type NotificationIdentity } from './notification-identity-protocol.ts';

export interface NotificationIdentityCodec {
  encode(identity: NotificationIdentity): unknown;
  decode(value: unknown): NotificationIdentity;
}
const plainIdentityCodec: NotificationIdentityCodec = { encode: parseNotificationIdentity, decode: parseNotificationIdentity };

/** Append-only identity evidence in a launcher-created isolated directory.
 * No task recovery, message contents or credentials. One launcher owns the directory.
 * A torn record blocks loading; silently discarding it could expose an internal notice.
 */
export class NotificationIdentities {
  private readonly records = new Map<string, NotificationIdentity>();
  private writes = Promise.resolve();
  private constructor(private readonly directory: string, readonly isolationId: string, private readonly codec: NotificationIdentityCodec) {}
  static async load(directory: string, isolationId: string, codec: NotificationIdentityCodec = plainIdentityCodec): Promise<NotificationIdentities> {
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(isolationId)) throw new Error('Invalid isolation identity');
    const ledger = new NotificationIdentities(await realpath(directory), isolationId, codec);
    const files = await readdir(ledger.directory, { withFileTypes: true });
    if (files.length > 1024) throw new Error('Notification identity capacity exceeded');
    for (const file of files) {
      if (!file.isFile() || !/^msg_[A-Za-z0-9_-]{1,176}\.json$/.test(file.name)) throw new Error('Unexpected identity entry');
      const handle = await open(join(ledger.directory, file.name), 'r');
      try {
        if ((await handle.stat()).size > 4096) throw new Error('Identity record too large');
        const record = parseNotificationIdentity(codec.decode(JSON.parse(await handle.readFile('utf8'))));
        if (file.name !== `${record.messageId}.json` || record.isolationId !== isolationId) throw new Error('Foreign identity record');
        ledger.insert(record);
      } finally { await handle.close(); }
    }
    return ledger;
  }
  private insert(record: NotificationIdentity) {
    for (const prior of this.records.values()) {
      if (prior.messageId === record.messageId || prior.notificationId === record.notificationId || prior.eventId === record.eventId) {
        if (JSON.stringify(prior) !== JSON.stringify(record)) throw new Error('Conflicting notification identity');
        return;
      }
    }
    this.records.set(record.messageId, record);
  }
  forParent(parentSessionId: string): NotificationIdentity[] {
    return [...this.records.values()].filter(r => r.parentSessionId === parentSessionId).map(r => ({ ...r }));
  }
  record(value: NotificationIdentity): Promise<void> {
    const record = parseNotificationIdentity(value);
    const operation = this.writes.then(async () => {
      if (record.isolationId !== this.isolationId) throw new Error('Foreign isolation identity');
      const prior = this.records.get(record.messageId);
      if (prior && JSON.stringify(prior) === JSON.stringify(record)) return;
      if (this.records.size >= 1024) throw new Error('Notification identity capacity exceeded');
      for (const existing of this.records.values()) {
        if (existing.notificationId === record.notificationId || existing.eventId === record.eventId || existing.messageId === record.messageId) {
          throw new Error('Conflicting notification identity');
        }
      }
      // Exclusive create: never replace an existing or partially written record.
      const handle = await open(join(this.directory, `${record.messageId}.json`), 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(this.codec.encode(record)), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      this.insert(record);
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
}
