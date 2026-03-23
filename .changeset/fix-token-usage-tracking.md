---
"@action-llama/action-llama": patch
---

Fix token usage and return value tracking in container runs. The `forwardLogLine` method returned early for all `_log` JSON lines before reaching the `token-usage` and `signal-result` detection code, so these values were never captured. Moved detection into the `_log` handling block so metrics are correctly recorded.
