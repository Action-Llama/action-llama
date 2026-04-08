---
"@action-llama/action-llama": patch
---

Fix Claude harness OAuth token injection by passing Anthropic OAuth credentials through `ANTHROPIC_AUTH_TOKEN` instead of `ANTHROPIC_API_KEY`-style auth, and cover the mapping with targeted credential setup tests.
