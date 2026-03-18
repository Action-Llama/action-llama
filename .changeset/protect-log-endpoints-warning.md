---
"@action-llama/action-llama": patch
---

Added warning when log endpoints are exposed without authentication. The gateway now
logs a warning if log routes are registered without an API key configured, helping
operators identify potential security risks. Closes #121.