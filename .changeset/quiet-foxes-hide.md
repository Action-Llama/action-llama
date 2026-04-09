---
"@action-llama/action-llama": patch
---

Hide verbose command output in the instance log viewer and redact tool-result payload text from log summaries. Command metadata (tool name, command string, error status) is preserved so the UI and summarizer still convey what happened without exposing raw output.
