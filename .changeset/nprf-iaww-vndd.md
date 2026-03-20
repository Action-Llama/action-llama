---
"@action-llama/action-llama": patch
---

Added local SQLite telemetry store (`.al/stats.db`) that persists agent run history
across scheduler restarts. Records duration, token usage, cost, hook timing, and
agent-to-agent call edges. View with `al stats [agent]`, `al stats --calls`, or
`al stats --json`. Data auto-prunes after 90 days.

Also renamed `al stat` to `al status` (`stat` remains as an alias for backward
compatibility), and added post-hook execution to the host agent runner.
