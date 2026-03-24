---
"@action-llama/action-llama": patch
---

Strict config validation and webhook credential defaults.

- `al doctor` now errors (not warns) on unknown fields in `config.toml` and agent SKILL.md frontmatter
- Webhook sources default `credential` to `"default"` — no need to specify `credential = "default"` in config.toml
- `scale` and `timeout` removed from agent SKILL.md frontmatter — use `[agents.<name>]` in config.toml instead
- Fixed false "unknown fields" warnings for standard fields (`models.sonnet`, `name`, `credentials`, etc.)
- Fixed duplicate `allowUnsigned` webhook warning logged twice on startup
- Added `agents` and `historyRetentionDays` to the global config schema
- Added e2e tests for the dashboard gateway (SSE stream, auth, API endpoints, control operations)
