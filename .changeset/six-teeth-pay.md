---
"@action-llama/action-llama": patch
---

Fix several bugs in the wait/resume and kill flows:

- Fix "Transport closed" error on wait/resume: `DockerExecTransport.connect()` now resets `_closed` so transport reconnection works after suspension
- Kill command now terminates waiting (suspended) instances, not just actively running ones
- `al stat` now shows "Waiting" agent status and waiting instance counts
- Agent Dockerfile cache invalidation: image tags now include a content hash so Dockerfile changes trigger rebuilds without requiring a new commit
- Re-register the `/locks/status` endpoint that was removed in a prior refactor (fixes 401 errors in `al stat` and the dashboard locks display)
- Add `"waiting"` state and `waitingCount` to frontend `AgentStatus` type
