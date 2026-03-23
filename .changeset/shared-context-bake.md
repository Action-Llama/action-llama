---
"@action-llama/action-llama": patch
---

Bake `shared/` directory into agent images. Files placed in `<project>/shared/` are now included in every agent's container at `/app/static/shared/`, allowing agents to reference common context (coding conventions, repo layout, policies) via direct context injection in SKILL.md (e.g., `!\`cat /app/static/shared/conventions.md\``).
