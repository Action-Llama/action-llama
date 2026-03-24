---
"@action-llama/action-llama": patch
---

Move agent runtime config (credentials, models, schedule, webhooks, hooks, params, scale, timeout) from SKILL.md YAML frontmatter to per-agent `config.toml` files. SKILL.md now contains only portable metadata (name, description, license, compatibility), making skills shareable across projects. Add `al add <repo>` to install skills from git repositories and `al update [agent]` to pull upstream SKILL.md changes. Add top-level `al config <name>` as a shortcut for interactive agent configuration.
