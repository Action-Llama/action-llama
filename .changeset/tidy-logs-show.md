---
"@action-llama/action-llama": patch
---

Improve log output: format debug events richly in `al logs -a` (show event type, role, tool name instead of bare "event"/"tool done"), and filter debug-level entries from the web UI log API by default (configurable via `?level=debug` query param). Add polling fallback to host-user streamLogs for reliability on systems where fs.watch is unreliable.
