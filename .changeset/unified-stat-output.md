---
"@action-llama/action-llama": patch
---

Unified `al stat` and `al stat -c` output to show the same structure: an agents
summary table with trigger types (cron, webhook, or manual) and instance counts,
plus a running instances table with per-instance trigger info. Added `al stat [agent]`
detail view showing full config (schedule, webhook sources/filters, scale, timeout)
and filtered instances. Closes #83.
