---
"@action-llama/action-llama": patch
---

Auto-source `/tmp/env.sh` before every bash command via `commandPrefix`.

Agents can now write `export REPO=...` to `/tmp/env.sh` once and have those
variables available in all subsequent bash tool calls, without needing to
re-export them each time. This fixes issues where agents lost shell variable
state between separate bash invocations.
