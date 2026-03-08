---
"@action-llama/action-llama": patch
---

Webhook events are now queued instead of silently dropped when an agent is busy. After a run
(including reruns) completes, the agent drains its queue before going idle. The queue is bounded
per-agent (default 20) and configurable via `webhookQueueSize` in `config.toml`. Queue depth
is visible in the TUI and dashboard.
