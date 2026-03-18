---
"@action-llama/action-llama": patch
---

Fixed `al push` crash-looping on the remote server due to a missing environment file.
The remote `.env.toml` no longer references a named environment; instead it inlines
gateway and telemetry config directly, so the server runs self-contained without
needing `~/.action-llama/environments/` on the remote.
