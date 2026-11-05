/** Transport only. The owner supplies a validated, redacted protocol projection. */
export interface ReadonlyBridgeOptions {
    snapshot(parentSessionId: string, signal: AbortSignal): Promise<unknown>;
    /** Normal integration supplies a derived token; labs retain a fresh random token. */
    token?: string;
    identity?(challenge: string): unknown;
    deadlineMs?: number;
    maxConcurrent?: number;
    maxResponseBytes?: number;
}
export interface ReadonlyBridge {
    /** Privileged discovery only: never forward this descriptor to a Webview. */
    endpoint: string;
    token: string;
    close(): Promise<void>;
}
export declare function startReadonlyBridge(options: ReadonlyBridgeOptions): Promise<ReadonlyBridge>;
