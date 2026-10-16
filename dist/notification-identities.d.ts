import { type NotificationIdentity } from './notification-identity-protocol.ts';
export { parseNotificationIdentity, type NotificationIdentity } from './notification-identity-protocol.ts';
export interface NotificationIdentityCodec {
    encode(identity: NotificationIdentity): unknown;
    decode(value: unknown): NotificationIdentity;
}
/** Append-only identity evidence in a launcher-created isolated directory.
 * No task recovery, message contents or credentials. One launcher owns the directory.
 * A torn record blocks loading; silently discarding it could expose an internal notice.
 */
export declare class NotificationIdentities {
    private readonly directory;
    readonly isolationId: string;
    private readonly codec;
    private readonly records;
    private writes;
    private constructor();
    static load(directory: string, isolationId: string, codec?: NotificationIdentityCodec): Promise<NotificationIdentities>;
    private insert;
    forParent(parentSessionId: string): NotificationIdentity[];
    record(value: NotificationIdentity): Promise<void>;
}
