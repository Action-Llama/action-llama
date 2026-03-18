---
"@action-llama/action-llama": patch
---

CLI commands now show a clear error when the gateway returns non-JSON responses
(e.g. HTML from a reverse proxy or misconfigured gateway URL) instead of crashing
with "Unexpected token '<'". Affects `al kill`, `al pause`, `al resume`, `al stop`,
`al run`, and `al stat`.
