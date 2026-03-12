---
"@action-llama/action-llama": patch
---

Harden gateway security: bind to localhost by default (cloud mode uses 0.0.0.0),
disable control routes/dashboard/lock-status endpoints in cloud mode since they
are local-only concerns, scope `/locks/list` to the requesting agent's own locks,
add 10 MB webhook body size limit, add per-IP rate limiting (120 req/min) on
webhook endpoints, validate agent names against `[a-z0-9-]` pattern, fix path
traversal in dashboard log access, replace `execSync` with `execFileSync` in
git helper to prevent shell injection, and warn when dashboard runs without
`AL_DASHBOARD_SECRET`.
