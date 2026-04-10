---
"@action-llama/action-llama": patch
---

Fix agent run logging: capture thinking/reasoning output from Pi SDK events, unwrap tool result JSON wrappers and suppress empty results, remove duplicate "session completed" line in favor of the more informative "run outcome" line.
