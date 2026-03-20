---
"@action-llama/action-llama": patch
---

Fixed MCP server agent info display to show all configured models instead of failing with TypeScript error. The server now correctly accesses the `models` array property instead of the non-existent `model` property. Closes #196.