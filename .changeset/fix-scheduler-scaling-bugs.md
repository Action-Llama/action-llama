---
"@action-llama/action-llama": patch
---

Fixed critical scheduler scaling bugs where only one agent instance could run at a time
despite scale > 1. The `isAgentRunning` runtime check blocked concurrent instances by
finding the first instance's container and bailing; this check is removed from the hot
path and replaced with startup-time orphan detection. The `_running` flag is now set
synchronously to close a race window. Agent-to-agent triggers are now queued instead of
silently dropped when all runners are busy. The `killInstance` method on RunnerPool now
correctly finds runners by instanceId.
