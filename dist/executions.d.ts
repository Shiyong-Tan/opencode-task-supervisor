import type { Clock, Identity } from './types.ts';
import type { Registry } from './registry.ts';
import type { JobSample, JobTransport } from './job-client.ts';
export interface ExecutionIdentity extends Identity {
    childSessionId: string;
    executionId: string;
    toolCallId: string;
}
export interface Execution extends ExecutionIdentity {
    displayName?: string;
    startedAt?: number;
    finishedAt?: number;
    cpuPercent?: number;
    phase: 'waiting_permission' | 'starting' | 'running' | 'stopped' | 'start_failed' | 'permission_denied';
    health: 'waiting_permission' | 'running' | 'suspect' | 'unknown' | 'stopped';
    createdAt: number;
    lastActivityAt: number;
    lastObservedAt?: number;
    sample?: JobSample;
    cpuDelta100ns?: string;
    readDeltaBytes?: string;
    writeDeltaBytes?: string;
    reason?: string;
    cancelRequested: boolean;
    cancelOutcomeUnknown: boolean;
    artifactPaths: string[];
    safeToRetry: false;
}
export declare class Executions {
    private readonly registry;
    private readonly clock;
    private readonly factory;
    readonly suspectMs: number;
    private readonly multiple;
    private readonly entries;
    private disposed;
    constructor(registry: Registry, clock: Clock, factory: (executionId: string) => JobTransport, suspectMs?: number, multiple?: boolean);
    private current;
    private owned;
    private copy;
    all(): Execution[];
    status(id: string, session: string): Execution;
    start(childSessionId: string, toolCallId: string, command: {
        executable: string;
        args: string[];
        cwd: string;
        artifactPaths: string[];
    }, permission: () => Promise<void>, abort?: AbortSignal): Promise<Execution>;
    private apply;
    private unknown;
    observe(id: string, session: string): Promise<Execution>;
    cancel(id: string, session: string): Promise<Execution>;
    dispose(): Promise<void>;
}
