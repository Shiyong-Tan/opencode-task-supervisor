import type { OpenCodeApi } from './opencode-api.ts';
export interface PermissionRule {
    permission: string;
    pattern: string;
    action: 'allow' | 'ask' | 'deny';
}
export interface AgentDispatch {
    agent: string;
    model: {
        providerID: string;
        modelID: string;
    };
    variant?: string;
    permission: PermissionRule[];
}
/** Read-only preparation. The plugin must additionally call ctx.ask(task, agent)
 * before handing this plan to the task owner. No kernel internals or config writes. */
export declare function prepareAgentDispatch(api: OpenCodeApi, parentSessionId: string, messageId: string, callerAgent: string, agent: string, signal: AbortSignal): Promise<AgentDispatch>;
