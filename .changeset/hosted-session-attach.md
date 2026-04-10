---
"@action-llama/action-llama": patch
---

Add hosted session attach protocol: `GET /sessions`, `GET /sessions/:id`, and `GET /sessions/:id/attach` (WebSocket) gateway endpoints let clients list and attach to running agent sessions in real time. The `@action-llama/action-llama/extension` Pi extension provides `/sessions` (interactive picker) and `/attach <id>` (full TUI takeover with live event streaming, steer, and abort) for use with `pi -e @action-llama/action-llama/extension`.
