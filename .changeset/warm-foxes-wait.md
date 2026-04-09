---
"@action-llama/action-llama": patch
---

Add `wait_for_trigger` tool that lets agents suspend mid-conversation and resume when a matching webhook or agent trigger arrives. Containers are paused while waiting to save resources. Configurable via `waitTimeout` (per-agent) and `defaultWaitTimeout` (project-wide).
