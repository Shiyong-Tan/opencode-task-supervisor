import { type NotificationIdentity } from './notification-identity-protocol.ts';
/** Wire v2 names the stable integration explicitly. Internal v1 projections retain
 * their legacy scope-key spelling so existing round owners need no migration. */
export interface NormalNotificationIdentity extends Omit<NotificationIdentity, 'schemaVersion' | 'isolationId'> {
    schemaVersion: 2;
    integrationId: string;
}
export declare function normalIdentityCodec(integrationId: string, identityKey: string): {
    encode(value: NotificationIdentity): unknown;
    decode(value: unknown): NotificationIdentity;
};
