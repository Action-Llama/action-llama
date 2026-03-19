---
"@action-llama/action-llama": patch
---

Made the scheduler work queue durable by backing it with SQLite instead of
an in-memory map with fire-and-forget persistence. Queued webhook events,
scheduled runs, and inter-agent triggers now survive process crashes and
restarts without risk of data loss. Closes #156.
