---
"@action-llama/action-llama": patch
---

Detect when all configured models are rate-limited or overloaded across all retry passes and exit with code 12 instead of silently succeeding with empty output.
