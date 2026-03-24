---
"@action-llama/action-llama": patch
---

Add `defaultAgentScale` config field to set the default number of concurrent runners for all agents. Agents without an explicit `[agents.<name>].scale` override will use this value instead of defaulting to 1. A warning is emitted at scheduler startup and by `al doctor` when the total requested scale exceeds the project-wide `scale` cap.
