---
"@action-llama/action-llama": patch
---

Only load model extensions for providers referenced in `config.toml` `[models]`,
instead of initializing all providers on startup. This eliminates noisy errors
like "OpenAI API key is required" when a project only uses Anthropic.
