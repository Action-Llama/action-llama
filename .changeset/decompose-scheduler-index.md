---
"@action-llama/action-llama": patch
---

Decomposed the 631-line `startScheduler()` monolith into focused modules: validation,
gateway setup, runner pool creation, call dispatching, cron setup, webhook bindings, and
shutdown. The orchestrator is now ~170 lines. Extracted a shared `registerWebhookBindings()`
used by both initial setup and hot-reload, eliminating duplicated webhook wiring logic.
No behavior changes.
