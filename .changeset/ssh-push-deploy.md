---
"@action-llama/action-llama": minor
---

Added `al push` command for deploying to self-hosted servers via SSH. Configure a
`[server]` section in an environment file with host, user, port, keyPath, and basePath,
then run `al push --env <name>` to sync project files and credentials, install a systemd
service running `al start --headless --expose`, and verify deployment with a health check.
Supports `--dry-run` to preview changes and `--no-creds` to skip credential sync.

Also changed `al env init` to require a `--type` flag (`server`, `ecs`, or `cloud-run`)
instead of defaulting to ECS. Removed support for `[cloud]` in `config.toml` — cloud
config must now be in an environment file.
