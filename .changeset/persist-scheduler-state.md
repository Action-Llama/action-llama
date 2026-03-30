---
"@action-llama/action-llama": patch
---

Persist scheduler state so running agent jobs survive scheduler restarts. On startup, the scheduler now re-adopts containers that are still running instead of killing them, and the SQLite-backed work queue is no longer cleared on shutdown. Closes #388.
