---
"@action-llama/action-llama": patch
---

Fixed misleading "webhook triggered agent" log when the agent is disabled. Previously,
the log was emitted even when the trigger callback silently skipped execution due to the
agent being disabled, making it appear the agent ran when it didn't. The registry now
checks the trigger return value and logs "webhook matched but agent skipped" instead.
