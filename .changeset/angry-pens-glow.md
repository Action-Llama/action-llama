---
"@action-llama/action-llama": patch
---

`al push` now fails with a clear error when required credentials are missing locally, instead of silently creating empty placeholder directories on the remote server. Implicit credentials like `gateway_api_key` (which are auto-generated on the server) are exempt from this check. Run `al doctor` to set up missing credentials before pushing.
