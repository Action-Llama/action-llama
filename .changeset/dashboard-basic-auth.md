---
"@action-llama/action-llama": patch
---

Added HTTP basic auth support for the web dashboard. Set the `AL_DASHBOARD_SECRET`
environment variable to require authentication on all `/dashboard` routes. Uses
timing-safe comparison to prevent timing attacks. When the env var is not set, the
dashboard remains open (no auth required).
