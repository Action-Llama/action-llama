---
"@action-llama/action-llama": patch
---

Update all documentation to reflect the per-agent config.toml system. SKILL.md now contains only portable metadata (name, description, license, compatibility) and instructions, while runtime configuration (credentials, models, schedule, webhooks, hooks, params, scale, timeout) lives in `agents/<name>/config.toml`. Also documents the new `al add`, `al config`, and `al update` commands, and removes the obsolete `[agents.<name>]` override pattern from project config docs.
