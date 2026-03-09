---
"@action-llama/action-llama": patch
---

Renamed `parallelism` config field to `scale` in agent-config.toml. The field controls how many instances of an agent can run concurrently. Updated all documentation, tests, and log messages to use the new naming. Closes #45.