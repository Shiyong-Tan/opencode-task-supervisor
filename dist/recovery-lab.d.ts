import type { Supervisor } from './supervisor.ts';
export interface Notice {
    key: string;
    parent: string;
    state: 'queued' | 'submitted' | 'unknown' | 'progress_observed' | 'escalated';
    createdAt: number;
    submittedAt?: number;
    baseline: Set<string>;
    reason?: string;
}
export declare class RecoveryLab {
    readonly supervisor: Supervisor;
    private readonly isolatedSessions;
    readonly recoveryMs: number;
    private readonly notices;
    private readonly busy;
    constructor(supervisor: Supervisor, isolatedSessions: ReadonlySet<string>, recoveryMs?: number);
    private assertIsolated;
    cancel(taskId: string, owner: string): Promise<void>;
    enqueue(taskId: string, owner: string): Notice;
    check(notice: Notice): Promise<void>;
}
