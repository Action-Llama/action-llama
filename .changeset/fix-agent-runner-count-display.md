---
"@action-llama/action-llama": patch
---

Fix agent runners showing wrong running count in the Web UI dashboard.

When a project-wide `scale` cap throttled individual agent pools, the status tracker still showed the original uncapped scale — causing displays like "3/4" when all runners were active. The tracker is now synced with actual pool sizes after runner pool creation.

Additionally, hot-reload scale changes now use `updateAgentScale` instead of re-registering the agent (which reset the running count to zero), and the "idle" state is no longer set unconditionally at the end of a hot reload when runners are still active. The `startRun` running-count clamp at `scale` has also been removed so the count reflects reality during scale transitions. Closes #331.
