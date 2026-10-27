# Recovery policy update

2026-10-19: Prepare stable 0.1.13 with quiet waits and observed process metrics.
Release is built from a clean Git archive, excluding the existing unstaged
notification identity file. GUI stays 6.0.0; no configuration change, ordinary
service restart or model invocation. Windows V1/V2 installation will be checked
in isolated profiles before stable promotion.


2026-10-19: Quiet-wait policy. Public V1/V2 dispatch and wait tools default to
until_attention: healthy sampling stays inside one tool invocation rather than
returning routine model checkpoints. Explicit mode checkpoint retains timed
coordination and existing persistent-stall recovery caps. Managed process waits
use the same default. Completion, interactions, uncertainty and suspected stalls
still return for review; interruption releases observation only. Core monitor
retains its checkpoint default for existing internal callers; public adapters
explicitly select the new policy. Validation: 171/171 controlled-clock tests, typecheck and build passed. No release, service restart or model call.

2026-10-19: Process waits publish bounded progress titles from owned execution
samples at entry and after each observation. Elapsed time uses execution start,
not the current wait call; CPU and live counts require fresh complete evidence.
Unknown/stale observations are explicit. No commands/output/environment values,
extra model calls, process mutation or automatic service reload is introduced.
GUI forwards this title to the existing call-keyed subagent display. This source
change is local and unversioned; publishing/reloading the plugin is still required. Validation: 165/165 controlled-clock tests, typecheck and build passed; no model calls. Both protocol activity fingerprints exclude only process-wait presentation titles, preserving real state/input/output/other metadata evidence so ticking clocks cannot mask stalls.

2026-10-16: Prepare 0.1.6 dual-protocol release. Windows real 2.0.24 acceptance
with openai/gpt-6-luna verifies one registered reviewer child, supervisor_dispatch,
supervisor_run launching a harmless owned Node command, supervisor_process_wait,
child result and parent final. Linux/WSL real 2.0.24 session/event/form contract,
native plugin lease/snapshot, process ownership and GUI service ownership pass
without model calls. The GUI's Windows acceptance found/fixed separate native
finality and question feedback/presentation issues; those fixes belong to the GUI
repository. Its production client verifies Steer, concurrent sessions, parallel
tool transcript identities, compaction, interruption without idle, and original
child question/read permission routing. The cumulative authorized 50-request
ledger includes failed network attempts and reconciled fixture requests; no
additional model requests are authorized. Full VS Code window manual acceptance
and native macOS remain outside the verified claims. Release automation now emits
the matching protocol manifest and checksums, so future plugin releases do not
require a GUI version bump just to change an archive URL. Preserve the preexisting
notification-identity-protocol.ts working-tree change.

2026-10-15: A real parent received suspected_stall at five minutes but repeatedly
requested 120-second waits until sixteen minutes of inactivity. Repeated health
alerts were deduplicated into full-length waits and shared healthy checkpoint
guidance. Cancellation then had no transition out of cancel_unknown.

Repeated suspected-stall waits now cap at 30 seconds, preserve anti-busy-loop
behavior, and return inspect_child_now / decide_recovery_now guidance. Cancellation
remains an explicit parent decision under the authorized task, without a routine
user-choice question. The plugin does not call a model, abort, or redispatch on its own.

Cancellation acknowledgement now triggers fresh observation. Terminal + idle +
no pending tool/permission/question + explicit execution-stop evidence can settle
the task. Known read-only tool history can exclude external execution; native,
unknown and nested task tools cannot. Registered execution requires complete owned
process-stop evidence with no coverage uncertainty. Idle, process inactivity,
API success and missing records never suffice alone. Linux escaped-process
uncertainty remains a blocker. Status refreshes before reporting; verified stopped
tasks expose safeToRetry for a new registration, never reuse a cancelled dispatch.

Validation uses fake-clock/adapter regression tests and build/typecheck; no model
calls, active-service changes, global configuration changes or runtime deployment.
GUI presentation already supports ended/failed; no GUI version change is needed.
Next: publish a separately authorized release and validate in an isolated profile.

2026-10-16: Native V2 integration supersedes the observation-only checkpoint below.
The package now exposes V1 root and V2 server entries, including server.js because
the real 2.0.24 local loader resolves server/index rather than package.main. Native
tool registration composes the shared Supervisor/process owners and preserves
permission asks and trusted call identity. Native dispatch prepares named roles,
model/variant and inherited permission rules before admitting one durable prompt.
Live event receipts distinguish genuine progress from polling; missing observation
remains unknown. Pending inbox work prevents false safe-to-retry cancellation.
Real isolated 2.0.24 plugin loading published a valid authenticated GUI lease and
served a correctly scoped bridge snapshot, with zero model calls. No global config,
ordinary service, public release or user notification-identity change was touched.
The dual-protocol release manifest generator is local only. Publish requires a
separate authorized release and version decision; existing 0.1.5 is not updated.

2026-10-16: Native V2 observation groundwork (historical checkpoint).
V2ObservationApi reads only the captured loopback service, verifies workspace and
session identity, consumes bounded ascending transcript pages, and reads native
active execution, permission and form resources. It never sends a prompt, retries
authentication or substitutes ports. snapshotFromV2 projects the shared supervision
policy facts: provider/step completion is not task completion; an explicit idle
execution outcome, with no outstanding tools/interactions, is required. Parallel
tool identity retains message and call IDs. Native/unrecognized execution and
supervisor_run require separate process-stop proof. Unknown states fail closed.
Seventeen targeted tests cover these boundaries; no model/service/global-config
changes. The V2 loader, tool registration, dispatch permission preparation and
notification integration are not yet implemented, so these modules are not wired
into the current V1 plugin entrypoint. Preserve the existing user change in
src/notification-identity-protocol.ts. Next: wire native V2 plugin registration and
the GUI's existing session owner, then perform dual-protocol end-to-end acceptance.

2026-10-15: Fixed 0.1.4 handshake/snapshot version mismatch with package-owned runtime versions. Real authenticated bridge regression compares lease and projection versions. Release 0.1.5 retains GUI 5.1.0 support.

2026-10-16: Published v0.1.6 at
https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/tag/v0.1.6.
Release source commit: 4603f22073ea279b162eca92c0def556731d19ec; archive built
from a clean git archive, excluding the user's unstaged notification identity
file. Uploaded tgz SHA256 and a fresh downloaded copy both match
09d5ef62cae1978566e313890a5df38d6b81422240a17369f6db599b4b62a819.
The actual unpacked artifact passed authenticated Windows 1.18.31 and 2.0.24
plugin loading/lease/snapshot checks without rewriting package exports. The GUI
production latest-release resolver accepts the live release for both V1 and V2,
including the matching native protocol manifest. Configuration format verification
was in memory only; no ordinary configuration/service was changed. The GUI fixes
are local commit 85a9c30 with 1827 tests passing; GUI remains 6.0.0. Model ledger
is exhausted at 50/50; full VS Code window manual acceptance and native macOS
are not claimed as completed.

2026-10-16 correction: the 0.1.6 resolver check above verified metadata, not remote installation. Actual fresh native installation rejects raw tgz URLs. Version 0.1.6 was demoted to prerelease. Version 0.1.7 adds a runtime-only compiled Git distribution tag for V2; V1 retains the archive. A fresh 2.0.24 profile successfully installed the equivalent runtime-only Git payload. Source index and existing user notification changes remain untouched. No additional model calls.

0.1.7 remote V2 Git install passed, but remote V1.18.31 package installation selected the server export too, then rejected its missing legacy server() function. Version 0.1.7 was demoted to prerelease. Version 0.1.8 exposes server() and setup() on that shared subpath, retaining the original root function for older loaders. Added regression and require both actual remote installation checks before stable promotion.

Final release 0.1.8: https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/tag/v0.1.8. Clean source 3cfdef2; runtime distribution commit 4a65a7f5d6464ba9f0c01294176b99e4b134b32a. Published tgz SHA256 27293a8e7b5fb964b8e8f3413c6d7656869960c120783a511bc9784c5251a7ef. Actual fresh Windows remote archive install on 1.18.31 and remote Git install on 2.0.24 both passed authenticated lease/snapshot, zero models. Tests 158/158 and typecheck pass. GUI 6.0.0 gates: 234 suites / 1828 tests; full manual Extension Host/macOS remain unclaimed. Existing user notification identity edit excluded from release and commits.

2026-10-16 native location recreation: real service logs show successful Git package import followed by setup failing because a previous location consumed the environment bootstrap. Native setup now retains only an authenticated bootstrap in module-private memory, revalidates workspace/authentication on reuse, and never restores the environment key. Regression disposes/recreates a same-workspace plugin then rejects a foreign workspace. 158 tests and typecheck passed before release version metadata change. No model calls or ordinary service restart.

Published stable v0.1.9 after real fresh Windows remote package installation, authenticated lease and snapshot on 1.18.31 and 2.0.24. Source a6f15a3; native distribution 0836b5341c73b2573a1665aaca7797f10254858d; archive SHA256 9257dfc2c2cab1b04f94097f9fc2a366c78927bf5ecfe6fa731f0115e9a5e6d1. No models, ordinary configuration edits or service restarts. Existing user notification identity change excluded.

2026-10-16 Windows native location aliases: real 2.0.31 logs load one plugin for j:\Vortex_coalescence and another for J:\Vortex_coalescence. Separate registries/bridges competed for one GUI discovery file, yielding a healthy connection with missing tasks. Native runtime now has one reference-counted registry/process owner/view/bridge per authenticated service ID and canonical workspace. Each location registers its own tools against that runtime; releasing one location does not dispose another active reference. Regression registers a task in one location and reads it through another, including after first disposal, without invoking models. Foreign-workspace validation remains before acquisition. GUI child text now projects the canonical accumulated assistant cache instead of a delta.

Published stable v0.1.10, source 2866508, Git distribution 273b4eff356f4acfbcd638fe901e26ef22cf9630. tgz SHA256 33d2fbd15bd12be2322fe18ea26a9909e48ef515b6ae922f32625d4ea653c6c0. Fresh remote install plus production GUI handshake and observation passed on Windows 2.0.31; activating the alternate drive-letter-case location kept the same bridge instance. Real 1.18.31 archive/GUI observation also passed. Canonical registry sharing and reference lifetime are directly regression-tested with registered tasks; no model calls.

2026-10-16 per-child environment: supervisor_run accepts optional string env overrides, validates keys/count/size/NUL and rejects private GUI bootstrap keys. Exact-command permission includes overrides; execution status does not retain values. Windows builds a Unicode environment block for CreateProcess inside the existing Job; Linux merges validated overrides only into spawn env. Service/helper environments remain unchanged. Tests 161/161, typecheck/build pass; real tracked Windows and Ubuntu/WSL smoke verifies project temp selection, Unicode, descendant inheritance, exit/stop evidence and unchanged parent environment. No models or ordinary service/configuration changes.

Published stable v0.1.11 after clean-source packaging and real Windows 1.18.31/2.0.31 remote installation, production GUI handshake/observation and native alias bridge checks. Source 7579199; distribution d17f3a5d8cd449d0e3e0ddd9e886524665b923fa; archive SHA256 a01f691ed738411e045f7e5670d562559cabb364403e77c9afee1771df4081c0. GUI remains 6.0.0 and needs no rebuild. Existing user notification identity change remains excluded.
# Persistent native todo tools — 2026-10-16

Add supervisor_todo_read/write for native OpenCode 2, with session identity taken
from tool context, bounded validated items, atomic private storage and revision
conflict protection. Native tools reuse todowrite authorization; no permission
configuration is changed. The existing authenticated GUI bridge adds an optional
session-fenced snapshot, preserving older clients and the V1 native todo path.
GUI live chat cards consume the same tool metadata, while its Supervisor panel
restores saved state after reconnect. No service restart or model call is used.
Local validation covers persistence, isolation, stale concurrent writes, clearing,
malformed storage, registration and GUI projection. Release publication remains
separate; version labels are unchanged for this local implementation.

# Release 0.1.12 — 2026-10-19

Publish the session-owned native todo tools from 55986a3. GUI stays at 6.0.0.
The release is built from a clean Git archive, excluding the user's unstaged
src/notification-identity-protocol.ts. No ordinary service/configuration change
or model request is authorized by this release task.

Published stable v0.1.12: https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/tag/v0.1.12.
Source 731ebde; compiled distribution f22cb8d65db492272590d1930c015d1a108df526.
Archive SHA256 c87e0fb1f15b57cd0fc4bdf74a694083a8d66196decb9608d0b8414894da4c26
matches a fresh GitHub download. Clean-source 163/163 tests, typecheck and build
passed. Actual fresh remote archive install on Windows OpenCode 1.18.31 and Git
install on 2.0.31 both passed authenticated lease/snapshot with plugin 0.1.12.
The production GUI release resolver accepts the stable release for both families.
No model calls, global/workspace configuration edits or ordinary service restarts.
GUI remains 6.0.0; existing notification identity edits remain excluded. Updating
an already-running plugin still requires an idle service reload by its owner.

Published stable v0.1.13: https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/tag/v0.1.13.
Source 891b8293fdb7805dbed831264577e7cdcb01fc45; compiled Git distribution
8fd12be2c2295d89f786f2cc627ee4b05e927d16 (package-v0.1.13).
Archive SHA256 4bbc30c48f027de0d10fa516d7beb4edd442dbca77a3868a43ba8af279d26b60
matches a fresh release download. Clean-source typecheck, 171/171 controlled-clock
tests and build passed. Fresh actual GitHub archive installation on Windows
OpenCode 1.18.31 and Git installation on 2.0.31 passed authenticated lease/snapshot
checks with plugin 0.1.13. GitHub latest now points to v0.1.13 and the GUI production
resolver accepts its protocol manifest for both families. Model calls: zero.
No global/workspace configuration changes or ordinary service restarts. Existing
notification identity edits remain excluded; GUI remains 6.0.0.
# Process review deadlines (local implementation, 2026-10-19)

- Add optional launch estimate/basis, inspection interval and expected progress.
  Existing callers receive a ten-minute review; first review is the earlier of
  estimate and requested check. Normal sampling remains internal.
- A due review returns the current execution as suspect even with ongoing activity;
  managed suspect evidence also reaches parent task observation. Read probes and
  sub-second accumulated polling CPU no longer continuously reset activity.
- Explicit owner-scoped review extension records a reason/count/deadline, preserves
  actual last activity and requires fresh non-unknown execution evidence. It cannot
  restart, resume, cancel or certify retry safety. No automatic recovery is added.
- Validation uses fake clocks/transport fixtures, not model calls or live job control.
  No version change, publication or ordinary service restart is part of this change.

Published stable v0.1.14: https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/tag/v0.1.14.
Source ab00447; compiled Git distribution 1899ab8ed363e8a1c2b2135ab4982c9142892145
(package-v0.1.14). Clean-source typecheck, 177/177 tests and package build passed.
Archive SHA256 a715555ebf6bcb1ba87d2c05cd8356cbc65616835e4464fb29fec3d452aaa83c
and protocol manifest checksum match fresh GitHub downloads. GitHub latest
confirmed stable v0.1.14. Source main and both tags pushed; user unstaged
notification identity edits excluded. GUI stays 6.0.0. No model calls, ordinary
service restart or configuration changes. Live remote-install acceptance was not
repeated for this release; Linux/macOS runtime acceptance remains unperformed.

# Windows Job closeout repair / v0.1.15

The lifetime 256-member handle cache in JobHost permanently latched unknown
coverage after sufficient process churn. The original binary reproduced this
with 470 observed members and never certified stop. Published v0.1.14, the
reported workspace vendor binary and the running cache binary have identical
SHA256 DA1598176797704E7565205FFF5723A0D38BDA9908909910AE522A071828E3DB.
This confirms binary identity, not termination of the old reported execution.

Retire signaled handles, apply the limit to concurrent retained members, and
reconcile each complete Job observation afresh. Incomplete enumeration, API
failures and live descendants remain conservative. Add bounded current and last
failure diagnostics (API/PID/creation identity/Win32/counts/closeout blockers).
Exact execution status now requests fresh evidence, allowing recovery without
relaunch or weakening review safety. Root exit or zero active count alone is
never stop proof.

Windows native regressions cover >256 historical members, exit codes 0/1,
root exit with live child, transient member-open failure, persistent member-query
failure while live and transient Job query failure. No production process was
cancelled, restarted or certified stopped. Existing notification identity edits
are excluded from the release; GUI version is unchanged.

Published stable v0.1.15:
https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/tag/v0.1.15.
Source 6a6f55b; compiled Git distribution
79dde2a61dbb1d38567a40599f747145ab62cd2d (package-v0.1.15).
Clean-source typecheck/build, 179/179 tests, Windows native churn
536/528 observed members (exit 0/1), root-exit/live-child guard and all three
fault-injection cases passed. Downloaded archive SHA256
ccae60ffe618bfab6fc4402ee3ded65f65076e1e46a063b5916d8addc3f4d457
matches the local artifact; all three release assets match fresh downloads.
GitHub latest confirmed v0.1.15; main and both tags pushed. No model calls,
GUI version/configuration changes or production service/process operations.
Linux/macOS runtime acceptance was not repeated. The old reported execution's
termination remains unverified; running old helpers are not hot-updated.

# V2 parent workspace scope repair (2026-10-27)

The reported parent ID matches its endpoint identity; its directory is
`g:\12.Echo_MRI` while the plugin realpath is `G:\12.Echo_MRI`. Prepare used
strict string equality unlike observation. Both now share the existing platform
path comparison: Windows normalizes resolved paths case-insensitively; POSIX
retains case. Exact session identity and foreign-workspace rejection remain.
180 tests and typecheck passed. No production task is dispatched or restarted,
and no configuration is changed. Source repair only; version stays 0.1.15 and
publication requires a separate release task. User notification edits excluded.

# Supervisor 0.1.16 release preparation (2026-10-27)

Publish ee6bdd1's native V2 parent scope repair from a clean Git archive. Exclude
unstaged notification identity edits. GUI version and production configuration
remain unchanged; no service restart, model call or dispatch is part of release.
