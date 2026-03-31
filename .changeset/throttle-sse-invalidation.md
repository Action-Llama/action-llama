---
"@action-llama/action-llama": patch
"@action-llama/frontend": patch
---

Throttle SSE status stream (max 2/sec) and debounce invalidation-driven refetches (1s) to prevent 429 errors from rapid-fire updates during active agent runs.
