---
"@action-llama/action-llama": patch
---

Separate agent runtime tuning from agent definitions. Per-agent `scale`, `timeout`, and `feedback` can now be overridden via `[agents.<name>]` sections in `.env.toml` or environment files, without modifying SKILL.md. Dashboard and TUI scale changes now write to `.env.toml` instead of rewriting SKILL.md, preventing remote/local config divergence after `al push`.
