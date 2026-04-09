---
"@action-llama/action-llama": patch
---

Strip verbose fields (`raw`, `result`, `resultText`, `content`, `turnResult`) from log entries before building the summarizer prompt. Long message text is truncated to 500 chars. Fixes context-too-large errors when summarizing agent runs.
