---
"@action-llama/action-llama": patch
---

Allow `scale = 0` in agent-config.toml to disable an agent. Disabled agents skip
credential validation, Docker image builds, cron jobs, and webhook bindings while
remaining visible (as disabled) in the TUI. This lets users keep agent configs in
the project without running them.
