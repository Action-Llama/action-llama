---
"@action-llama/action-llama": patch
---

Cleaned up scheduler plain-logger output: removed noisy agent-level events (assistant turns,
bash commands, tool errors) from stdout. Only core scheduling events (triggers, completions,
shutdowns, rate-limit retries) now appear. Agent details remain in file logs. When running
agents at scale > 1, instance-level start/completion lines are now shown (e.g. `reviewer(1) started`).
