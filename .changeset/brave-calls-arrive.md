---
"@action-llama/action-llama": minor
---

Replace fire-and-forget `[TRIGGER]` mechanism with agent-to-agent calls that return values. Agents can now use `al-call`, `al-check`, and `al-wait` shell commands to invoke other agents, continue working, and retrieve structured results via `[RETURN]...[/RETURN]` blocks. Calls are queued in a unified per-agent work queue (shared with webhook events) when all runners are busy, with a configurable `workQueueSize` (default: 100). New config fields: `maxCallDepth` (replaces `maxTriggerDepth`, default: 3), `workQueueSize` (replaces `webhookQueueSize`, default: 100). Old field names still work as fallbacks.
