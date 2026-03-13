---
"@action-llama/action-llama": patch
---

Simplified CLI commands: renamed `al status` to `al stat`, merged per-agent
`al agent pause/resume/kill` into `al pause [name]`, `al resume [name]`, and
`al kill <target>` (tries agent name first, falls back to instance ID). The
`al agent` subcommand group has been removed.
