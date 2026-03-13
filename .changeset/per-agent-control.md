---
"@action-llama/action-llama": patch
---

Added per-agent pause, resume, and kill commands. Use `al agent pause <name>` to stop
scheduling new runs for a specific agent, `al agent resume <name>` to re-enable it, and
`al agent kill <name>` to terminate all running instances of an agent. The gateway also
exposes these as `POST /control/agents/:name/pause`, `/resume`, and `/kill` endpoints.
`al status` now shows `(PAUSED)` next to disabled agents. The container runner's `abort()`
method now properly kills the running Docker container instead of being a no-op.
