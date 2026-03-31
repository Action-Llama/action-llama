---
"@action-llama/action-llama": minor
---

Add per-agent `maxWorkQueueSize` setting in agent `config.toml`. Overrides the global `workQueueSize` for individual agents, allowing fine-grained control over work queue capacity. Oldest events are dropped to make room for newer ones when the queue is full. Closes #473.
