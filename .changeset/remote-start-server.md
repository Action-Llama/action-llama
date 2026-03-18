---
"@action-llama/action-llama": patch
---

`al start -E <name>` now starts the remote systemd service via SSH when the environment
has a `[server]` section, instead of always starting a local scheduler. Checks if the
service is already running, and polls the health endpoint for up to 30s after starting.
