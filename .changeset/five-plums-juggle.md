---
"@action-llama/action-llama": patch
---

Accept both `key` and legacy `apiKey` fields on the dashboard login API. This keeps existing Web UI and automation clients working when authenticating against `/api/auth/login`.
