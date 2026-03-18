---
"@action-llama/action-llama": patch
---

`al push` now supports `--creds-only`, `--files-only`, and `--all` flags for selective syncing, and delegates config validation to `al doctor --check-only` instead of performing its own credential check. Bootstrap runs Node/Docker/al readiness checks in parallel and returns resolved binary paths (`BootstrapResult`); the generated systemd unit uses absolute paths for `al` and `node` with a proper `PATH` env var and `-w` flag. `al agent config` webhook setup now offers a credential picker (pick existing or add new) instead of raw text input. `al doctor` validates that webhook sources referenced by agents exist in config.toml, and health-check failures now display service status and recent logs for debugging.
