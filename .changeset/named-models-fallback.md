---
"@action-llama/action-llama": minor
---

Replaced singular `[model]` config with named models (`[models.<name>]`) and model
fallback chains. Define models once in `config.toml`, reference by name in SKILL.md
frontmatter (`models: [sonnet, haiku]`). First model is primary; the rest are tried
automatically on rate limits via an in-memory circuit breaker. Breaking change: the
old `[model]` section in config.toml and inline `model:` block in SKILL.md are removed.
