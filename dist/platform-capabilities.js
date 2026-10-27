/** Task supervision uses HTTP on every platform; native process evidence is optional. */
export function supportsProcessTracking(platform) { return platform === 'win32' || platform === 'linux'; }
/** Packaged OpenCode's Bun executable is a CLI, not a general JS script runner. */
export function linuxHelperRuntime(versions, executable) { return versions.bun ? 'node' : executable; }
export const untrackedProcessGuidance = `\n\nThis platform supports Supervisor task dispatch and observation, but native process tracking is unavailable. supervisor_run and supervisor_process_* are not exposed. Do not claim ordinary command processes are tracked. Keep all role permissions and approval requirements; if the assignment requires tracked execution, report that limitation before launching. Never relaunch an existing process to obtain tracking, or infer process-tree exit from a cancelled/idle session.`;
