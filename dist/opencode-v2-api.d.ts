import { V2ObservationApi } from './v2-observation-api.ts';
import type { Api } from './types.ts';
import type { AgentDispatch } from './agent-dispatch.ts';
type ObjectValue = Record<string, unknown>;
/** Native V2 mutations. The shared Supervisor remains the sole task/retry policy owner. */
export declare class OpenCodeV2Api extends V2ObservationApi implements Api {
    private readonly liveProgress;
    private streamAvailable?;
    activityStreamAvailable(available: boolean): void;
    recordLive(value: unknown): void;
    observe(sessionId: string, signal: AbortSignal): Promise<import("./types.ts").Snapshot>;
    verifyCompatibility(signal: AbortSignal): Promise<string>;
    create(parentSessionId: string, title: string, signal: AbortSignal, selection?: AgentDispatch): Promise<string>;
    dispatch(childSessionId: string, prompt: string, signal: AbortSignal): Promise<void>;
    abort(sessionId: string, signal: AbortSignal): Promise<void>;
    notify(): Promise<void>;
    ask(context: {
        sessionID: string;
        messageID: string;
        id: string;
        agent: string;
        signal: AbortSignal;
    }, action: string, resources: string[], metadata?: ObjectValue): Promise<void>;
    prepare(parentSessionId: string, messageId: string, caller: string, agent: string, signal: AbortSignal): Promise<AgentDispatch>;
}
export {};
