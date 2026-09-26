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
    "https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/download/v0.1.1/opencode-task-supervisor-0.1.1.tgz",
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
- On Windows, use `supervisor_run` for long commands requiring process tracking; continue `supervisor_process_wait` for that execution ID.
- On a suspected stall, inspect evidence before deciding whether to cancel or redispatch. Quiet commands and successful cancellation responses are not proof of process termination.

Dispatching and optional notifications can invoke your configured models and incur their normal costs. Installation does not invoke models. Notifications are disabled by default. Tool permissions still apply; the plugin never grants blanket approval.

## Compatibility and limits

Validated against OpenCode 1.18.29 and 1.18.31; required APIs are checked rather than rejecting every newer version number. Windows is required for GUI-managed service restart and tracked process execution. Other platforms do not have equivalent managed process coverage.

The 0.1.1 compatibility update separates HTTP task supervision from native
process tracking. Linux/macOS retain task registration, dispatch, wait, status and
results; Windows-only process tools are omitted and dispatch explains the missing
coverage. POSIX GUI bindings preserve case-sensitive workspace identity. GUI
setup never attempts native Windows service operations on Linux/macOS; an existing
service may need a manual stop before a fresh GUI launch.

This update is tested with simulated Linux/macOS plugin initialization and signed
POSIX-path bindings on Windows, not Linux/macOS end-to-end execution. Use GUI 5.0.9 or later with plugin 0.1.1. The older v0.1.0 release remains unchanged.


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

Run the **Build release** GitHub Actions workflow manually. It runs tests on Windows and produces the npm tarball plus SHA-256 checksum as a workflow artifact. Create GitHub Release `v0.1.1` and attach those files. Publishing the repository alone does not make the installation URL available.

MIT License. Copyright (c) 2026 Shiyong Tan.
