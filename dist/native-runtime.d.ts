import { SessionTodos } from './todos.ts';
import { OpenCodeV2Api } from './opencode-v2-api.ts';
import { Supervisor } from './supervisor.ts';
import { ViewProjection } from './view-projection.ts';
import { prepareNormalPlugin } from './normal-plugin.ts';
type Normal = Awaited<ReturnType<typeof prepareNormalPlugin>>;
/** One registry, process owner and bridge for an authenticated physical workspace.
 * Native location aliases still register their own tools, using this shared owner. */
export declare function acquireNativeRuntime(normal: Normal, directory: string, origin: string, authorization: string, version: string): Promise<{
    release(): Promise<void>;
    api: OpenCodeV2Api;
    supervisor: Supervisor;
    tracked: {
        executions: import("./executions.ts").Executions;
        before(input: {
            tool: string;
            sessionID: string;
            callID: string;
        }, output: {
            args: unknown;
        }): void;
        tick(): Promise<void>;
        dispose: () => Promise<void>;
        tools: {
            supervisor_run: {
                description: string;
                args: {
                    executable: import("zod").ZodString;
                    args: import("zod").ZodArray<import("zod").ZodString>;
                    cwd: import("zod").ZodString;
                    env: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>>;
                    estimatedDurationMs: import("zod").ZodOptional<import("zod").ZodNumber>;
                    estimateReason: import("zod").ZodOptional<import("zod").ZodString>;
                    checkAfterMs: import("zod").ZodOptional<import("zod").ZodNumber>;
                    progressExpectation: import("zod").ZodOptional<import("zod").ZodString>;
                };
                execute(args: {
                    executable: string;
                    args: string[];
                    cwd: string;
                    env?: Record<string, string> | undefined;
                    estimatedDurationMs?: number | undefined;
                    estimateReason?: string | undefined;
                    checkAfterMs?: number | undefined;
                    progressExpectation?: string | undefined;
                }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
            };
            supervisor_process_status: {
                description: string;
                args: {
                    executionId: import("zod").ZodOptional<import("zod").ZodString>;
                };
                execute(args: {
                    executionId?: string | undefined;
                }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
            };
            supervisor_process_review: {
                description: string;
                args: {
                    checkAfterMs: import("zod").ZodNumber;
                    reason: import("zod").ZodString;
                    executionId: import("zod").ZodString;
                };
                execute(args: {
                    checkAfterMs: number;
                    reason: string;
                    executionId: string;
                }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
            };
            supervisor_process_wait: {
                description: string;
                args: {
                    mode: import("zod").ZodDefault<import("zod").ZodEnum<{
                        until_attention: "until_attention";
                        checkpoint: "checkpoint";
                    }>>;
                    waitMs: import("zod").ZodDefault<import("zod").ZodNumber>;
                    executionId: import("zod").ZodString;
                };
                execute(args: {
                    mode: "until_attention" | "checkpoint";
                    waitMs: number;
                    executionId: string;
                }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
            };
        };
    } | undefined;
    todos: SessionTodos;
    view: ViewProjection;
    references: number;
    dispose(): Promise<void>;
}>;
export {};
