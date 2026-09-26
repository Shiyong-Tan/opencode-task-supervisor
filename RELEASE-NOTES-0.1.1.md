# OpenCode Task Supervisor 0.1.1

- Support case-preserving POSIX workspace bindings and retain task supervision on Linux/macOS without initializing Windows native process tools.
- Track child question requests as waiting for input and exclude finished/aborted tool requests.
- Advertise the actual plugin version; companion GUI 5.0.9 accepts 0.1.0 and 0.1.1 and migrates the known old official download URL.

Native process tracking and GUI-managed service restart remain Windows-only. Linux/macOS platform branches are fixture-tested on Windows; native end-to-end acceptance remains pending. On those platforms, finish active work and stop an old OpenCode service manually before a fresh GUI-owned launch loads the new plugin. No automatic task retry or process termination is added.

Use the attached plugin tarball with the companion GUI 5.0.9 VSIX. SHA256SUMS lists artifact checksums.
