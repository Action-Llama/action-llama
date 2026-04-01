---
"@action-llama/action-llama": patch
---

Log summarize endpoint errors now appear in `al logs`. Previously, 500 errors from the log summary route were returned as HTTP responses but never logged via the logger, making them invisible to `al logs`.
