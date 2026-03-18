---
"@action-llama/action-llama": patch
---

Added `-E`/`--env` flag to `al stop` so it can target a remote scheduler.
Previously `al stop` always hit the local gateway.
