---
"@action-llama/action-llama": patch
---

Unified scheduler webhook and agent-trigger queues into a single per-agent work queue.
This simplifies the drain logic (two separate drain functions replaced by one), removes
~240 lines of code, and fixes a bug where webhook run completions did not drain queued
agent-trigger items. Also fixed a latent crash in the rerun loop when `triggers` was
undefined in the run outcome.
