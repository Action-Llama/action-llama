---
"@action-llama/action-llama": patch
---

Return specific error messages from the trigger agent endpoint instead of a generic 404. The response now distinguishes between "agent not found", "no available runners", "scheduler paused", and "scheduler not ready", making it possible to diagnose trigger failures from the dashboard.
