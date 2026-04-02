---
"@action-llama/action-llama": patch
---

Fix log summaries only including short message labels (e.g. "assistant", "token-usage") instead of full log content. Entries with extra fields like assistant text, bash commands, tool results, and errors are now serialized as JSON so the model can see the actual content.
