---
"@action-llama/action-llama": patch
---

`al env prov` now checks for an existing Origin CA certificate before generating a new one. If a certificate already exists, it prompts whether to regenerate (default: No) instead of generating unconditionally and then asking whether to overwrite.
