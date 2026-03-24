---
"@action-llama/action-llama": patch
---

Fixed scheduler pause not blocking webhook triggers. When the scheduler was paused
via `al pause`, webhooks could still trigger agent runs and queue work. Now all
trigger paths (webhooks, agent-to-agent calls, manual triggers, and queue draining)
respect the paused state and reject new work. Closes #162.
