import type { Snapshot } from './types.ts';
/** Retriable only for read-only pagination, never for a mutation response. */
export declare class V2ResponseBoundError extends Error {
    readonly method: 'GET' | 'POST';
    constructor(method: 'GET' | 'POST', path: string);
}
/** Read-only monitoring side of the native V2 port; mutations belong to the V2 plugin entrypoint. */
export declare class V2ObservationApi {
    readonly options: {
        baseUrl: string;
        directory: string;
        authorization: string;
        isCurrent(): boolean;
        fetch?: typeof fetch;
    };
    private readonly origin;
    constructor(options: {
        baseUrl: string;
        directory: string;
        authorization: string;
        isCurrent(): boolean;
        fetch?: typeof fetch;
    });
    private current;
    protected request(path: string, signal: AbortSignal, method?: 'GET' | 'POST', body?: unknown, timeoutMs?: number): Promise<unknown>;
    protected read(path: string, signal: AbortSignal): Promise<unknown>;
    verifyVersion(signal: AbortSignal): Promise<string>;
    protected matchesWorkspace(directory: unknown): boolean;
    observe(sessionId: string, signal: AbortSignal): Promise<Snapshot>;
}
