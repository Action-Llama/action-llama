---
"@action-llama/action-llama": patch
---

Fix dashboard integration tests by passing a StatusTracker to startScheduler when webUI:true in the test harness. Also exposes StatusTracker via internals/status-tracker export path.
