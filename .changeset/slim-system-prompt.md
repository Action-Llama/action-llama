---
"@action-llama/action-llama": patch
---

Replace Pi's default system prompt with a minimal agent-specific one, eliminating ~800 tokens of irrelevant boilerplate per LLM call. Move the stable prompt skeleton (agent-config, credentials, environment, skills) from the user message into the system prompt, enabling automatic prefix caching on OpenAI and other providers.
