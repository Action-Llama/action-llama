---
"@action-llama/action-llama": patch
---

Fix Claude harness runs so aborted Claude CLI sessions return a non-zero container exit instead of being logged as completed, and show Claude stderr details in the default `al logs` output.
