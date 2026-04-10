---
"@action-llama/action-llama": patch
---

Hosted sessions now load project `.pi` resources by default. Extensions, skills, prompts, themes, and system prompts from the project's `.pi/` directory are automatically discovered and applied. The Action Llama system prompt (agent config, credentials, environment context) is appended on top rather than replacing the project-level prompt.
