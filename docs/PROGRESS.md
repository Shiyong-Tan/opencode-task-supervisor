# Recovery policy update

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
