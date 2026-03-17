---
"@action-llama/action-llama": minor
---

Portable projects: three-layer config separation and agent-scoped credentials.

**Config changes:**
- Project config (`config.toml`) is now portable — cloud infrastructure details belong in environment files
- Added `.env.toml` (gitignored) for per-project environment binding and config overrides
- Added `~/.action-llama/environments/<name>.toml` for shared cloud infrastructure config
- Config merge order: `config.toml` -> `.env.toml` -> environment file (later wins, deep merge)
- `[cloud]` in `config.toml` emits a deprecation warning; move to an environment file

**CLI changes:**
- Replaced `-c`/`--cloud` flag with `-E`/`--env <name>` on all commands (start, run, doctor, stat, logs, kill, pause, resume, chat, cloud deploy)
- Added `al env init <name>`, `al env list`, `al env show <name>` commands
- Environment can also be set via `AL_ENV` env var or `.env.toml`'s `environment` field
- Cloud mode is now auto-detected from the merged config (presence of `[cloud]` section)

**Credential changes:**
- Agent credentials now resolve with agent-specific -> default fallback (`type/<agent-name>/` then `type/default/`)
- Cross-agent credential references: `credentials = ["other-agent/github_token"]`
- Legacy `type:instance` syntax still works with a deprecation warning
- `"default"` is now a reserved name and cannot be used as an agent name

**Scaffolding:**
- `al new` now adds `.env.toml` to `.gitignore`
