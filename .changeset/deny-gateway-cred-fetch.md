---
"@action-llama/action-llama": patch
---

Deny gateway credential fetch (403) for containers whose credentials were injected
via environment variables. Previously returned 404; now explicitly rejects the request
to reduce the credential-fetch surface for ECS/Lambda containers.
