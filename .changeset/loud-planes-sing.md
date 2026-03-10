---
"@action-llama/action-llama": patch
---

Headless mode (`al start`) now shows why each agent is running. Log lines include
the trigger reason: `schedule`, `webhook`, `triggered by <agent>`, or `schedule (rerun N/M)`.
