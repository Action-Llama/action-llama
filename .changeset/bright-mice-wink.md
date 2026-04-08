---
"@action-llama/action-llama": patch
---

Action Llama can now run agents through the Claude CLI via `[harness].type = "claude"` while keeping `pi` as the default harness. This change also removes `al chat` and the web chat UI/API, simplifying the gateway and frontend to scheduled, webhook, and manual run flows only.
