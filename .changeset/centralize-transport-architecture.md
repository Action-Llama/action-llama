---
"@action-llama/action-llama": minor
---

Centralize agent sessions into the scheduler process with pluggable transport layer.

LLM sessions now run in-process in the scheduler ("brain"), while commands execute on runtimes ("body") via a Transport abstraction. This replaces the previous architecture where the Claude CLI harness ran inside Docker containers and communicated with the scheduler over HTTP.

**New transport types:**
- `container` (default) — Docker container via `docker exec`
- `ssh` — remote VM via persistent SSH connection
- `host-user` — local OS user via `sudo -u`

Configure per-agent in `agents/<name>/config.toml`:
```toml
[runtime]
type = "ssh"
host = "10.0.0.5"
user = "deploy"
key_path = "~/.ssh/id_rsa"
```

**Breaking changes:**
- Removed Claude CLI harness support (Pi is now the only harness)
- Removed container registration/unregistration HTTP routes
- Removed `useBakedImages` from scheduler context
- Removed `_run-agent` hidden CLI command
