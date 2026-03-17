---
"@action-llama/action-llama": patch
---

Stop logging the gateway API key during `al cloud deploy`. The doctor
check-only mode (used by cloud deploy in CI) now skips the gateway API
key section entirely instead of generating and printing the key to stdout.
