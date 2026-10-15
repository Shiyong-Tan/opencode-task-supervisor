# OpenCode Task Supervisor

Task supervision and process tracking for OpenCode, with an optional OpenCode GUI status panel.

## Install with OpenCode GUI

Install the companion GUI, open a trusted workspace, and turn on **Supervisor** beside the model variant selector. The GUI adds the pinned release to the workspace OpenCode configuration. On Windows it can restart its own OpenCode service. On Linux/macOS it uses the ordinary GUI start/reuse path; an already-running service must be stopped manually when tasks are finished before the GUI can launch it with the new plugin binding. Running or permission-blocked tasks require confirmation before restart. External services are never taken over.

The configuration editor preserves other plugins and permission rules. Turning the switch off hides the GUI observer; it does not stop tasks or uninstall the backend plugin.

## Manual installation

Download the release, or add this declaration to your workspace `opencode.json` (merge with any existing plugin array):

```json
{
  "plugin": [[
    "https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/download/v0.1.3/opencode-task-supervisor-0.1.3.tgz",
    { "allowDispatch": true, "allowNotifications": false, "normalGui": { "enabled": true } }
  ]]
}
```

OpenCode installs the package on startup. Restart OpenCode after changing the declaration. The GUI bridge uses a private launch binding supplied by OpenCode GUI. Outside GUI launches, the tools remain available without the GUI bridge.

## Agent usage

- Register a task with `supervisor_register`.
- Dispatch it with `supervisor_dispatch({ taskId, agent: "reviewer", prompt, waitMs: 60000 })`.
- Continue monitoring the same task with `supervisor_wait`; inspect `supervisor_status` and `supervisor_result`.
- A dispatch checkpoint is not task completion. Continue until a result or a clear blocker, rather than ending the parent turn after dispatch.
- On Windows or Linux/WSL, use `supervisor_run` for long commands requiring process tracking; continue `supervisor_process_wait` for that execution ID.
- On a suspected stall, inspect evidence before deciding whether to cancel or redispatch. Quiet commands and successful cancellation responses are not proof of process termination.

Dispatching and optional notifications can invoke your configured models and incur their normal costs. Installation does not invoke models. Notifications are disabled by default. Tool permissions still apply; the plugin never grants blanket approval.

## Compatibility and limits

Validated against OpenCode 1.18.29 and 1.18.31; required APIs are checked rather than rejecting every newer version number.

Windows uses Job Object accounting. Linux (including OpenCode running inside WSL) now exposes `supervisor_run`, `supervisor_process_status`, and `supervisor_process_wait` using a detached helper and `/proc` sampling. When OpenCode runs as a bundled Bun CLI, the detached helper requires `node` (Node.js 18 or newer) on PATH; the OpenCode executable itself cannot run the helper script. No global installation is performed by the plugin. Supply absolute Linux executable and working-directory paths, e.g. `/usr/bin/python3`, not Windows paths. The existing exact-command permission and child-task ownership checks still apply.

Linux coverage is the newly created process group, not OS-enforced containment. CPU/I/O, bounded output, root start ticks, exit code, and remaining group members are observed. Root exit does not finish an execution while group members remain alive. Processes that daemonize, call `setsid`, or leave the group are not reliably contained; group completion does not authorize overlapping replacement (`safeToRetry` remains false). Disposal detaches observation without terminating work. Missing `/proc` evidence is unknown, not stopped. macOS process tools remain unavailable.

No GUI protocol change is required. An already-running OpenCode service must be explicitly reloaded after its tasks finish to load a newly installed plugin. Tests include standalone real process fixtures in WSL; no models or existing OpenCode service are used.


Native OpenCode `task` calls are not automatically supervised. Tasks must use the Supervisor dispatch tools. The registry is in memory; restarting the service does not resume or recover old tasks. Only registered processes have process-tree evidence.

## Build and test

Use Node.js 24 and npm. On Windows, building the process helper requires the .NET Framework C# compiler.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm pack
```

The Windows release package contains `dist/native/JobHost.exe`, all compiled modules and package dependencies declared for OpenCode to install. No global installation or API credentials are needed to build and test. Tests use fixtures and do not call paid models.

## Release

Run the **Build release** GitHub Actions workflow manually. It runs tests on Windows and produces the npm tarball plus SHA-256 checksum as a workflow artifact. Create GitHub Release `v0.1.3` and attach those files. Publishing the repository alone does not make the installation URL available.

MIT License. Copyright (c) 2026 Shiyong Tan.

## Release 0.1.2

Removes the cumulative 128-execution launch limit for `supervisor_run`.
Permission checks, task/attempt ownership and duplicate-call protection remain
unchanged. Execution history is retained for the plugin instance lifetime;
memory use grows with retained history. No automatic eviction or process restart.

Use the v0.1.2 release archive. GUI 5.0.13 installs it and migrates the official
0.1.0/0.1.1 URLs when enabling Supervisor. Finish active tasks before reloading
an existing OpenCode service; publishing this release does not hot-update it.

## Release 0.1.3

Unreleased recovery changes: persistent stall checkpoints cap repeated waits at
30 seconds and require an explicit parent recovery decision. Routine cancellation
does not require asking the user. Cancellation can settle only with terminal,
idle, approval-clear and verified execution-stop evidence; unknown native or escaped
processes still block retry. No automatic abort or redispatch is performed.

Linux and WSL now support supervisor_run, supervisor_process_status and supervisor_process_wait. Existing command permissions and task ownership are preserved. Bundled Bun OpenCode requires Node.js 18+ on PATH for the detached Linux helper. Linux tracking covers the owned process group, not daemonized descendants that escape it. No automatic cancellation or redispatch is added.

GUI 5.1.0 can discover the latest official release when enabling Supervisor; no GUI version bump is required. Install this release and explicitly reload OpenCode after current tasks finish. Installation does not update an already loaded plugin.
