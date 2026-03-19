---
"@action-llama/action-llama": patch
---

Fix `al pause <agent>` not preventing new runs from starting. Queued work items, agent-to-agent triggers, and reruns for a paused agent are now suppressed. Closes #172.
