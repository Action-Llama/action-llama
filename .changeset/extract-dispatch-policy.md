---
"@action-llama/action-llama": minor
---

Extract webhook queueing / dispatch policy into `dispatchOrQueue()` in `src/execution/dispatch-policy.ts`. Centralizes the "check paused → check pool → check runner → queue or execute" decision that was previously duplicated across five call sites (webhook handler, cron handler, triggerAgent, call-dispatcher, dispatchTriggers). Pure refactoring — no behavior changes.
