---
"@action-llama/action-llama": patch
---

`al run <agent>` now triggers runs through the gateway instead of building and
running Docker containers directly. The scheduler must be running (`al start`)
for `al run` to work. This makes `al run` consistent with other CLI commands
and ensures runs go through the same execution path as cron/webhook triggers.
