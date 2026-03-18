---
"@action-llama/action-llama": patch
---

Added rich exit codes to all gateway-calling shell commands (`rlock`, `runlock`,
`rlock-heartbeat`, `al-call`, `al-check`, `al-wait`, `al-status`). Previously
most commands exited 0 regardless of HTTP status, causing agents to misinterpret
failures as successes — notably, multiple agents could acquire the same resource
lock because `rlock` always exited 0.

Exit codes now map HTTP statuses to distinct values: 0=success, 1=conflict,
2=not found, 3=auth error, 4=bad request, 5=unavailable, 6=unreachable,
7=unexpected, 8=timeout (al-wait only). These don't overlap with agent exit
codes (10–16) or POSIX signals (128+).
