---
"@action-llama/action-llama": patch
---

Improve summarizer to identify specific resources (e.g. "issue #42", "file config.toml") by preserving a 150-char excerpt from tool results and updating the prompt to request concrete identifiers.
