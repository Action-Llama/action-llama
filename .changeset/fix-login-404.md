---
"@action-llama/action-llama": patch
---

Fixed /login returning 404 when the gateway has an API key configured but the web UI
is disabled. Login/logout routes are now registered whenever auth is active, not only
when the full dashboard is enabled.
