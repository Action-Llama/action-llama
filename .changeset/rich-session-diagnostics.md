---
"@action-llama/action-llama": patch
---

Surface richer agent session diagnostics: stop reason, last tool calls, orphaned tools, and token usage are now tracked end-to-end from the harness through the container to `al logs` output. The logs command formats session-ended summaries, run outcomes, rate-limit events, signals, and hook results with structured detail instead of raw JSON.
