import type { Supervisor } from './supervisor.ts';
import type { Identity } from './types.ts';
import type { Execution } from './executions.ts';
export interface CompletionNotice extends Identity {
    execution?: Execution;
    eventId: string;
    notificationId: string;
    messageId: string;
    delivery: 'queued' | 'submitting' | 'submitted' | 'unknown' | 'received';
    progress: 'not_observed' | 'activity_observed' | 'result_read';
    createdAt: number;
    submittedAt?: number;
    receivedAt?: number;
    activityObservedAt?: number;
    resultReadMessageId?: string;
    escalated?: string;
    idleSince?: number;
    baseline: Set<string>;
}
export declare class Notifications {
    readonly supervisor: Supervisor;
    readonly recoveryMs: number;
    readonly idleSettleMs: number;
    private readonly beforeSubmit?;
    private readonly notices;
    private readonly inFlight;
    constructor(supervisor: Supervisor, recoveryMs?: number, idleSettleMs?: number, beforeSubmit?: ((notice: Readonly<CompletionNotice>) => Promise<void>) | undefined);
    enqueue(taskId: string, owner: string): CompletionNotice | undefined;
    all(): CompletionNotice[];
    enqueueCancellation(execution: Execution): CompletionNotice | undefined;
    forTask(taskId: string, owner: string): CompletionNotice | undefined;
    readResult(taskId: string, owner: string, messageId: string, notificationId?: string): void;
    private safe;
    check(notice: CompletionNotice): Promise<void>;
    tick(): Promise<void>;
}
export declare function noticeReport(notice: CompletionNotice): {
    closedLoop: string;
    execution?: Execution;
    eventId: string;
    notificationId: string;
    messageId: string;
    delivery: "queued" | "submitting" | "submitted" | "unknown" | "received";
    progress: "not_observed" | "activity_observed" | "result_read";
    createdAt: number;
    submittedAt?: number;
    receivedAt?: number;
    activityObservedAt?: number;
    resultReadMessageId?: string;
    escalated?: string;
    taskId: string;
    attemptId: string;
    parentSessionId: string;
    childSessionId?: string;
};
