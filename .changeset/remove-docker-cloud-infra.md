---
"@action-llama/action-llama": minor
---

Remove built-in Docker image management and cloud infrastructure provisioning.

Agents now use pre-existing Docker images configured via `local.image` in `config.toml` — the `FROM` Dockerfile pattern is gone. Cloud infrastructure commands (`al env prov`, `al env deprov`, `al env check`) are removed; users deploy the scheduler as a plain Node.js service to any platform (Railway, Render, self-hosted VPS). Credential injection now happens via the transport layer rather than volume mounts. The `al push` server deployment workflow and `al env init/list/show/set/logs` commands are unaffected.
