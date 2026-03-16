---
"@action-llama/action-llama": patch
---

Added `--expose` / `-e` flag to `al start` for VPS deployment. Binds the gateway to `0.0.0.0` (public) while keeping all local-mode features enabled (web UI, control routes, filesystem credentials, SQLite state). Closes #91.