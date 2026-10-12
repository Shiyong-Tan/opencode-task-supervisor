
## 2026-10-12: Linux / WSL process tracking

Added a Linux helper behind JobTransport. Linux exposes supervisor_run/status/wait
with trusted tool-call identity, exact-command permission and current child ownership.
Absolute Linux paths are required. /proc start ticks and a dedicated process group
supply CPU/I/O, memory, bounded output, root exit and remaining member evidence.
Root exit with live group members is not completion. Disposal detaches without
killing work. No takeover, cancellation or redispatch added. Group tracking is not
containment: daemonized/setsid escapes cannot be claimed stopped; safeToRetry stays
false. macOS process tools remain unavailable.

Public plugin: 125 fixture tests passed. Real isolated WSL tests passed for birth
identity, CPU/output, nonzero exit, live descendants after root exit, rejected cancel,
detach survival and the real processTools permission/owner/wait boundary. No live
OpenCode services, models, configs or DBs used. GUI protocol and version unchanged.
Compiled Linux helper is included in dist. Publishing/installing/restarting services
is not part of this change. Next: load the tested build during an explicit user
maintenance window; publish under a new release only when authorized.
Bundled Bun OpenCode uses Node.js 18+ on PATH for its detached helper; preflight checks fail before launching the command if that runtime is missing. No global installation performed. Final fixture suite: 126 passed.
