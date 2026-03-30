---
"@action-llama/action-llama": patch
---

Fix ghost runner leak and manual trigger queuing when all runners are busy.

When `withSpan` threw before `_runInternalContainer` ran, the `ContainerAgentRunner` would be permanently stuck with `isRunning === true`, causing the runner pool to show "all busy" even though the status tracker had no record of it. The `run()` method now wraps the `withSpan` call in a try/catch and resets `_running` on failure.

Manual triggers via the control API now queue when all runners are busy (matching webhook/schedule behavior) instead of returning an error string. This means pressing Run in the dashboard while an agent is running will queue the request and return an instanceId.

Frontend API errors with JSON bodies (e.g. `{"error":"..."}`) now display the human-readable message instead of raw JSON.

Closes #404
