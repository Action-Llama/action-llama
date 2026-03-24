---
"@action-llama/action-llama": patch
---

Fix dashboard "Disconnected" on deployed servers by disabling nginx proxy buffering for the SSE status-stream endpoint.

- `al push` now generates a dedicated nginx `location /dashboard/api/status-stream` block with `proxy_buffering off`, `proxy_cache off`, and a 24-hour read timeout for long-lived SSE connections
- Without this fix, nginx buffers SSE events and the browser's EventSource never receives data, causing the dashboard to show "Disconnected"
