---
"@action-llama/action-llama": patch
---

Renamed `parallelism` to `scale` in agent config. Update your agent-config.toml files to use `scale` instead of `parallelism`. The functionality remains the same - it controls how many instances of an agent can run concurrently. Closes #45.