---
"@action-llama/action-llama": patch
---

Fix instance log route rejecting valid instance IDs. The `/api/logs/agents/:name/:instanceId` endpoint expected only the hex suffix but the dashboard passes the full instance ID (e.g., `planner-e778111c`). The route now treats the instance ID as an opaque string and uses it directly as the log filter.
