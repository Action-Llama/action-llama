---
"@action-llama/action-llama": patch
---

Added `expose` field to `[server]` config for `al push` deployments. Set `expose = false` to bind the gateway to localhost only instead of `0.0.0.0`, which is useful when running behind a reverse proxy. Defaults to `true` for backward compatibility. Closes #152.
