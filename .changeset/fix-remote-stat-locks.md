---
"@action-llama/action-llama": patch
---

Always register the `/locks/status` gateway endpoint, even when the gateway
is publicly exposed. The endpoint is already protected by API key auth, so the
old `isPublic` guard was unnecessarily hiding it from remote `al stat` calls.
Also improved `al stat` to report connection/auth errors when targeting a remote
environment instead of silently falling back to local-only info.
