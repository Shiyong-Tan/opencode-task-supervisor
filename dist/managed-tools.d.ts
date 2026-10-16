import { Executions } from './executions.ts';
import type { Supervisor } from './supervisor.ts';
import type { Notifications } from './notifications.ts';
export interface ManagedLabOptions {
    enabled: true;
    helper: string;
    workspace: string;
    suspectMs?: number;
    profiles: Record<string, {
        executable: string;
        args: string[];
        cwd: string;
        artifactPaths: string[];
    }>;
}
export declare function managedTools(supervisor: Supervisor, notifications: Notifications | undefined, options: ManagedLabOptions, audit: (event: Record<string, unknown>) => Promise<void>): Promise<{
    executions: Executions;
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
        managed_start: {
            description: string;
            args: {
                profile: import("zod").ZodString;
            };
            execute(args: {
                profile: string;
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        managed_status: {
            description: string;
            args: {
                executionId: import("zod").ZodString;
            };
            execute(args: {
                executionId: string;
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        managed_output: {
            description: string;
            args: {
                executionId: import("zod").ZodString;
            };
            execute(args: {
                executionId: string;
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        managed_cancel: {
            description: string;
            args: {
                executionId: import("zod").ZodString;
            };
            execute(args: {
                executionId: string;
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        managed_result: {
            description: string;
            args: {
                notificationId: import("zod").ZodString;
                executionId: import("zod").ZodString;
            };
            execute(args: {
                notificationId: string;
                executionId: string;
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        managed_artifact: {
            description: string;
            args: {
                index: import("zod").ZodDefault<import("zod").ZodNumber>;
                executionId: import("zod").ZodString;
            };
            execute(args: {
                index: number;
                executionId: string;
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
    };
}>;
