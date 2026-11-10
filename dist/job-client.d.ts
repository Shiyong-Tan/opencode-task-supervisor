export interface JobSample {
    lastObservationIssue?: {
        observedAt: string;
        rootPid: number;
        rootCreationFileTime: string;
        assigned: number;
        count: number;
        activeBefore: number;
        activeAfter: number;
        trackingLimit: boolean;
        errorCount: number;
        errors: {
            api: string;
            pid: number;
            creationFileTime: string | null;
            win32: number;
        }[];
        blocked: string[];
    } | null;
    observation?: {
        enumerationComplete: boolean;
        assigned: number;
        count: number;
        activeBefore: number;
        activeAfter: number;
        trackedHandles: number;
        retired: number;
        trackingLimit: boolean;
        errorCount: number;
        errors: {
            api: string;
            pid: number;
            creationFileTime: string | null;
            win32: number;
        }[];
        blocked: string[];
    };
    executionId: string;
    sequence: number;
    observedAt: string;
    rootPid: number;
    rootCreationFileTime: string;
    rootExited: boolean;
    exitCode: number | null;
    activeProcesses: number;
    members: {
        pid: number;
        creationFileTime: string;
        alive: boolean;
        cpu100ns: string;
    }[];
    workingSetBytes?: string | null;
    cpu100ns: string;
    readBytes: string;
    writeBytes: string;
    requestAccepted: boolean;
    ownedProcessesStopped: boolean;
    coverageUnknown: boolean;
    cancelOutcomeUnknown: boolean;
    stdout: {
        text: string;
        totalBytes: number;
        retainedBytes: number;
        truncated: boolean;
    };
    stderr: JobSample['stdout'];
    scope: string;
}
export interface JobTransport {
    call(op: 'start' | 'sample' | 'cancel', args?: Record<string, unknown>): Promise<JobSample>;
    close(): Promise<boolean>;
}
/** One client owns one helper and its unnamed Job. Never attaches to a PID. */
export declare class JobClient implements JobTransport {
    readonly executionId: string;
    private readonly timeoutMs;
    private readonly observeOnly;
    private readonly host;
    private readonly pending;
    private serial;
    private buffer;
    private closed;
    private readonly exited;
    constructor(helper: string, executionId: string, tempDirectory: string, timeoutMs?: number, observeOnly?: boolean, runtime?: string);
    private fail;
    call(op: 'start' | 'sample' | 'cancel', args?: Record<string, unknown>): Promise<JobSample>;
    close(): Promise<boolean>;
}
