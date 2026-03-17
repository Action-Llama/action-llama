---
"@action-llama/action-llama": patch
---

Added a gateway log API (`/api/logs/scheduler`, `/api/logs/agents/:name`, `/api/logs/agents/:name/:instanceId`) with cursor-based pagination, time range filtering, and multi-instance aggregation. The CLI now fetches logs from the gateway API in local mode (falling back to direct file reading when the gateway isn't running), and the web UI uses cursor polling instead of SSE.
