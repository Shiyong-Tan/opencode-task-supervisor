import type { Snapshot } from './types.ts';
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
    observe(sessionId: string, signal: AbortSignal): Promise<Snapshot>;
}
