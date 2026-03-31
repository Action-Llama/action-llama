---
"@action-llama/action-llama": patch
"@action-llama/skill": patch
---

Extract AI integration content (AGENTS.md, MCP config, Claude Code commands) into new `@action-llama/skill` package. Scaffolded projects now depend on `@action-llama/skill` and receive content updates via `npm update` instead of re-scaffolding.
