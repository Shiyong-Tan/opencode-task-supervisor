/** Task supervision uses HTTP on every platform; native process evidence is optional. */
export declare function supportsProcessTracking(platform: NodeJS.Platform): boolean;
/** Packaged OpenCode's Bun executable is a CLI, not a general JS script runner. */
export declare function linuxHelperRuntime(versions: {
    node?: string;
    bun?: string;
}, executable: string): string;
export declare const untrackedProcessGuidance = "\n\nThis platform supports Supervisor task dispatch and observation, but native process tracking is unavailable. supervisor_run and supervisor_process_* are not exposed. Do not claim ordinary command processes are tracked. Keep all role permissions and approval requirements; if the assignment requires tracked execution, report that limitation before launching. Never relaunch an existing process to obtain tracking, or infer process-tree exit from a cancelled/idle session.";
