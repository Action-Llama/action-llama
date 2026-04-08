---
"@action-llama/action-llama": patch
---

Document defensive error handlers in scheduler webhook dispatch and execution paths. The `.catch()` handlers are unlikely to trigger since `executeRun()` and `drainQueues()` wrap all errors internally, but they remain for defensive programming and safety if those functions are modified to propagate errors in the future. Closes #574
