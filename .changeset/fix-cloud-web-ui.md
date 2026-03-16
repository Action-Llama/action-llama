---
"@action-llama/action-llama": patch
---

Respect the --web-ui flag in cloud mode. Previously, cloud mode forced the web UI
off, causing a 404 on /dashboard after login. Also added a root URL redirect to
/dashboard when the web UI is enabled.
