---
"@action-llama/action-llama": patch
---

Fixed security hole where dashboard routes could be registered without authentication. When `webUI` is enabled but no API key is configured, the gateway now logs an error and skips dashboard registration entirely. `registerDashboardRoutes` also has a defense-in-depth check that returns 503 if called without an API key. Closes #155.
