# OpenCode Task Supervisor

## Process review deadlines

Before `supervisor_run`, estimate duration from prior runs or workload when possible.
Supply `estimatedDurationMs` with `estimateReason`, `checkAfterMs` for the first
inspection, and `progressExpectation` describing expected output/checkpoints.
Unknown estimates are allowed: explain the uncertainty and choose a bounded check.
Existing callers get a ten-minute checkpoint; the first deadline is the earlier
of the estimate and the requested check (default ten minutes). Intervals are
1 second to 24 hours. This is a review deadline, never a termination timeout.

Healthy sampling stays internal. `supervisor_process_wait` returns `health:
"suspect"` with `review.needed` at the deadline even if CPU/output remains active.
Five minutes without useful CPU/write/output activity also requires review.
Read counters and tiny polling CPU alone do not establish useful activity; CPU
accumulates until at least one CPU-second, while output/write growth counts as
activity. These signals do not prove business progress. No files are scanned or
inferred as progress; the agent inspects task-specific evidence named in its plan.

After an alert, inspect the original execution and task evidence. If bounded waiting
is justified, call `supervisor_process_review({ executionId, checkAfterMs, reason })`.
The reason must describe the inspection and evidence; it is recorded, not mechanically
verified. Repeated waits do not acknowledge an alert. An explicit extension defers
the next review without changing `lastActivityAt`, restarting, resuming or cancelling
anything. Unknown observations and cancelled/stopped executions cannot be extended.
The parent task also surfaces `suspected_stall` when managed execution needs review.
No automatic kill/retry or additional model request is issued by sampling.

## Quiet waits (Supervisor 0.1.13)

`supervisor_dispatch`, `supervisor_wait` and `supervisor_process_wait` now default
to `mode: "until_attention"`. A healthy wait stays inside the tool instead of
returning every 30/60 seconds for another model decision. It returns on completion,
permission/question attention, suspected stall, failed observation or other health
changes that need review. Silence is suspicion, not proof of failure. There is no
automatic process cancellation or retry. GUI observations continue independently.

For intentional timed coordination, explicitly use `mode: "checkpoint"` with
`waitMs` (task default 60000, range 1000-120000; process default 30000, range
1000-60000). Supplying `waitMs` alone does not opt into checkpoints. Stopping a
wait only aborts observation; it does not prove child/process termination.

This reduces periodic model turns; initial dispatch and final/attention handling
still use the configured models. Update the plugin to 0.1.13 or later and perform an
idle service reload. No GUI version change or global configuration edit is needed.

## Persistent todo lists for OpenCode 2

Available starting with Supervisor 0.1.12. Enable/update Supervisor in the GUI
after active work finishes so OpenCode loads the new plugin. GUI 6.0.0 already
supports these tools and does not need another version change. For multi-step
work, agents should read the current list, then write it as work progresses.

`supervisor_todo_read({})` reads the calling session's list and revision.
`supervisor_todo_write({ expectedRevision, items })` replaces it atomically; read
first and preserve each item's stable `id`. Items have `content` (up to 500
characters), `status` (`pending`, `in_progress`, `completed`) and `priority`
(`high`, `medium`, `low`). At most 64 items are accepted. An empty list clears it.
Concurrent stale updates fail instead of silently losing changes.

These direct native tools use the existing `todowrite` permission. The caller
cannot supply another session ID. Lists persist in GUI private workspace storage
and are available over the existing authenticated read-only bridge after restart.
The GUI shows live updates in chat Todo cards and the current session's saved list
in the Supervisor panel. OpenCode 1 retains its native `todowrite` implementation.

## OpenCode 1 and 2 support (0.1.8)

The package keeps the OpenCode 1 default export and adds the native
OpenCode 2 `server` export (plus server.js for local directory loading). Version
labels are not compatibility allowlists. OpenCode 2 uses `plugins` entries with
`package` and `options`; OpenCode 1 retains its `plugin` tuples. Both share the
same task, cancellation, process ownership and observation policy.

Native V2 registration preserves named agents, catalog-validated model/variant
selection and inherited deny rules. Dispatch stays inline until completion or attention by default; bounded checkpoints are explicit;
it does not automatically finalize the parent, wake it through a synthetic prompt,
approve permissions or redispatch uncertain execution. Pending inbox items block
cancellation safety even after an interrupt acknowledgement. Native event progress
distinguishes actual deltas/tool progress from repeated polling; unavailable event
observation is unknown, not proof of progress or stall.

Build with `npm run build` and package with `npm pack`. Publish a compiled Git
distribution using `node scripts/native-distribution.mjs <archive> --push`, then
create the protocol manifest with `node scripts/release-protocol-manifest.mjs
<archive> <nativeCommit>`. Attach the archive and manifest to the release.
OpenCode 1 uses the release archive; OpenCode 2 uses
`git+https://github.com/Shiyong-Tan/opencode-task-supervisor.git#package-v0.1.8`.
The compiled Git payload excludes development scripts and development dependencies.
Release 0.1.6 is a prerelease: its archive works locally but its direct download
URL is not installable by the native OpenCode 2 package manager.
Real isolated 2.0.24 loading, authenticated lease and snapshot checks use zero
model calls. Windows real-model acceptance additionally verifies named dispatch,
tracked process launch/wait and parent completion with openai/gpt-6-luna. Linux/WSL
2.0.24 session/plugin loading and process/service ownership checks pass without
model calls. Native macOS and full VS Code window acceptance are not certified.

Task supervision and process tracking for OpenCode, with an optional OpenCode GUI status panel.

## Install with OpenCode GUI

Install a compatible companion GUI, open a trusted workspace, and turn on **Supervisor** beside the model variant selector. The GUI resolves the official stable release and writes its verified package URL to workspace configuration. Current GUI builds manage their own idle Windows/Linux/WSL service; active tasks and permission waits lock service changes. External services are never taken over. Native OpenCode 2 additionally requires the GUI's native protocol adapter; a plugin update alone cannot add that adapter to an older GUI.

The configuration editor preserves other plugins and permission rules. Turning the switch off hides the GUI observer; it does not stop tasks or uninstall the backend plugin.

## Manual installation

Download the release, or add this declaration to your workspace `opencode.json` (merge with any existing plugin array):

```json
{
  "plugin": [[
    "https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/download/v0.1.5/opencode-task-supervisor-0.1.5.tgz",
    { "allowDispatch": true, "allowNotifications": false, "normalGui": { "enabled": true } }
  ]]
}
```

OpenCode installs the package on startup. Restart OpenCode after changing the declaration. The GUI bridge uses a private launch binding supplied by OpenCode GUI. Outside GUI launches, the tools remain available without the GUI bridge.

## Agent usage

- Register a task with `supervisor_register`.
- Dispatch it with `supervisor_dispatch({ taskId, agent: "reviewer", prompt })`.
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

Run the **Build release** GitHub Actions workflow manually. It runs tests on Windows and produces the npm tarball plus SHA-256 checksum as a workflow artifact. Create GitHub Release `v0.1.5` and attach those files. Publishing the repository alone does not make the installation URL available.

MIT License. Copyright (c) 2026 Shiyong Tan.

## Release 0.1.2

Removes the cumulative 128-execution launch limit for `supervisor_run`.
Permission checks, task/attempt ownership and duplicate-call protection remain
unchanged. Execution history is retained for the plugin instance lifetime;
memory use grows with retained history. No automatic eviction or process restart.

Use the v0.1.2 release archive. GUI 5.0.13 installs it and migrates the official
0.1.0/0.1.1 URLs when enabling Supervisor. Finish active tasks before reloading
an existing OpenCode service; publishing this release does not hot-update it.

## Release 0.1.4

Recovery changes: persistent stall checkpoints cap repeated waits at
30 seconds and require an explicit parent recovery decision. Routine cancellation
does not require asking the user. Cancellation can settle only with terminal,
idle, approval-clear and verified execution-stop evidence; unknown native or escaped
processes still block retry. No automatic abort or redispatch is performed.

Linux and WSL now support supervisor_run, supervisor_process_status and supervisor_process_wait. Existing command permissions and task ownership are preserved. Bundled Bun OpenCode requires Node.js 18+ on PATH for the detached Linux helper. Linux tracking covers the owned process group, not daemonized descendants that escape it. No automatic cancellation or redispatch is added.

GUI 5.1.0 can discover the latest official release when enabling Supervisor; no GUI version bump is required. Install this release and explicitly reload OpenCode after current tasks finish. Installation does not update an already loaded plugin.

## Release 0.1.5

Fix a 0.1.4 regression where the handshake reported 0.1.3 while snapshots reported 0.1.4. Package metadata now owns all runtime version identities. GUI 5.1.0 remains supported.

## Per-process environment

Supervisor 0.1.11 adds optional `env` to `supervisor_run`, for example `"env": {"TMP": "D:\\project\\.tmp", "TEMP": "D:\\project\\.tmp", "TMPDIR": "D:\\project\\.tmp"}`. Create the directory first. Values override only the launched child and its descendants; the service environment and global configuration are unchanged. Windows and Linux/WSL use the same tool interface. Exact command permission includes overrides. Up to 32 string entries / 8 KiB are accepted; private GUI bootstrap keys are rejected. These variables guide cooperating programs and do not guarantee filesystem containment or control every conda cache.

## Release 0.1.15

Fix Windows Job closeout after many short-lived child processes: exited handles
are retired and the tracking limit applies to concurrent members. Incomplete
observations remain conservative but can recover on a fresh complete sample.
Root exit alone never certifies that descendants stopped. Current and last
observation diagnostics include API errors and closeout blockers. Call
`supervisor_process_status` with the same execution ID to retry observation;
do not relaunch an uncertain execution.

Install the new release and reload OpenCode after active tasks finish. Already
running helpers are not hot-updated. The GUI does not need a version change.

## Release 0.1.16

Fix native V2 dispatch rejecting equivalent Windows workspace paths such as
`g:\12.Echo_MRI` and `G:\12.Echo_MRI`. Dispatch preparation now shares the
monitoring path comparison: resolved Windows paths ignore case; POSIX paths keep
case. Exact parent session identity and foreign workspace rejection are retained.
This does not dispatch or retry existing tasks automatically. Update the plugin
and reload OpenCode after active tasks finish; running plugins are not hot-updated.
