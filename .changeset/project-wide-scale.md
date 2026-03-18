---
"@action-llama/action-llama": patch
---

Added project-wide scale configuration to limit the maximum number of simultaneous agent runs across all agents. Set `scale = <number>` in config.toml to prevent server overload. The scheduler enforces this limit by reducing individual agent scales if needed, and `al doctor` validates that agent scales don't exceed the project limit. Closes #133.