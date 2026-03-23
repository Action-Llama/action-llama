---
"@action-llama/action-llama": patch
---

Fix `al push --no-creds` to skip credential validation entirely, including the ANTHROPIC_API_KEY requirement. Previously, `collectCredentialRefs` was called unconditionally which triggered model/provider validation even when `--no-creds` was specified.
