---
"@action-llama/action-llama": patch
---

Fix `al add` and `al update` to discover SKILL.md files in `agents/` subdirectories, not just `skills/`. Repos that organize skills under `agents/*/SKILL.md` (e.g., `Action-Llama/agents`) now work correctly.
