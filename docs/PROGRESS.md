# Recovery policy update

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
