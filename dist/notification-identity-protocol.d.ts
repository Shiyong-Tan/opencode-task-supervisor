export interface NotificationIdentity {
    schemaVersion: 1;
    isolationId: string;
    instanceId: string;
    taskId: string;
    attemptId: string;
    parentSessionId: string;
    childSessionId: string;
    notificationId: string;
    eventId: string;
    messageId: string;
}
export declare function parseNotificationIdentity(value: unknown): NotificationIdentity;
