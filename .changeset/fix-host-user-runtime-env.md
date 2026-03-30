---
"@action-llama/action-llama": patch
---

Fix host-user runtime environment so agents can connect to the gateway and find tools. Gateway URL now uses `localhost` instead of Docker-internal `gateway` hostname, bin scripts (`rlock`, `al-status`, etc.) are added to PATH, and the agent prompt correctly describes a writable filesystem with CWD instead of Docker-specific `/app/static` and read-only assumptions. Credential context references `$AL_CREDENTIALS_PATH` instead of the Docker volume mount at `/credentials/`.
