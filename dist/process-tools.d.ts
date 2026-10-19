import { type JobTransport } from './job-client.ts';
import { Executions } from './executions.ts';
import type { Supervisor } from './supervisor.ts';
export declare const processGuidance = "\n\nProcess tracking for this supervised task:\nUse supervisor_run for long-running computation, builds and tests. Supply the absolute executable path, argument array and working directory; a shell script requires an explicit shell executable. Optional env supplies per-process environment overrides (for example TMP, TEMP and TMPDIR set to an existing project-local directory). Overrides are inherited by descendants; they do not enforce filesystem containment. Command and environment permission is checked before launch.\nThe tool returns an executionId, NOT completion. Prefer the default until_attention wait mode: healthy sampling stays internal, without timed model checkpoints. Use mode checkpoint only when an explicit coordination deadline is needed. Continue supervisor_process_wait on that SAME execution until it stops or needs review; read its bounded output and exit code. Never finalize merely because a command was started.\nSimple reads may use ordinary tools; ordinary shell processes are not tracked. If tracking is unavailable, report it. Never relaunch an uncertain execution or silently fall back to another launch tool. Quiet/GPU/waiting processes are not proven dead. No automatic termination or retry.\nOn Linux/WSL, tracking covers a newly created process group using /proc identity and counters. Do not daemonize, call setsid, or move descendants out of that group. Group completion is not proof that escaped descendants stopped; safeToRetry remains false. Use Linux executable/cwd paths when OpenCode runs inside WSL.";
/** Only this module installs normal-mode process evidence; laboratory mode stays separate. */
export declare function processTools(supervisor: Supervisor, directory: string, factory?: (id: string) => JobTransport): Promise<{
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
        supervisor_run: {
            description: string;
            args: {
                executable: import("zod").ZodString;
                args: import("zod").ZodArray<import("zod").ZodString>;
                cwd: import("zod").ZodString;
                env: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>>;
            };
            execute(args: {
                executable: string;
                args: string[];
                cwd: string;
                env?: Record<string, string> | undefined;
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
}>;
