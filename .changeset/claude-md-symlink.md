---
"@action-llama/action-llama": patch
---

New projects created with `al new` now include a `CLAUDE.md` symlink alongside `AGENTS.md`,
both pointing to the shipped AGENTS.md in node_modules. This allows Claude Code (which looks
for CLAUDE.md) to automatically pick up agent instructions without extra setup.
