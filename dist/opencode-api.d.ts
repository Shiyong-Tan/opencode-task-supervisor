import { type OpenCodeVersion } from './opencode-version.ts';
import type { AgentDispatch } from './agent-dispatch.ts';
import type { Api, Snapshot } from './types.ts';
export declare function snapshotFrom(sessionId: string, messagesValue: unknown, statusesValue: unknown, permissionsValue: unknown, questionsValue?: unknown): Snapshot;
export interface HttpOptions {
    baseUrl: string;
    directory: string;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
    model?: {
        providerID: string;
        modelID: string;
    };
    noReply?: boolean;
}
export declare class OpenCodeApi implements Api {
    readonly options: HttpOptions;
    constructor(options: HttpOptions);
    request(path: string, method: string, signal: AbortSignal, body?: unknown): Promise<unknown>;
    verifyVersion(signal: AbortSignal): Promise<OpenCodeVersion>;
    /** Read-only probe. Effectful operations are validated only when explicitly requested. */
    verifyCompatibility(signal: AbortSignal): Promise<OpenCodeVersion>;
    create(parentSessionId: string, title: string, signal: AbortSignal, selection?: AgentDispatch): Promise<string>;
    dispatch(childSessionId: string, prompt: string, signal: AbortSignal, selection?: AgentDispatch): Promise<void>;
    observe(sessionId: string, signal: AbortSignal): Promise<Snapshot>;
    abort(sessionId: string, signal: AbortSignal): Promise<void>;
    notify(sessionId: string, text: string, signal: AbortSignal, messageId?: string): Promise<void>;
}
