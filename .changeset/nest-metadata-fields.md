---
"@action-llama/action-llama": minor
---

Nest AL-specific SKILL.md fields under `metadata` key for platform compatibility.

Action Llama's custom frontmatter fields (`credentials`, `models`, `schedule`, `webhooks`, `hooks`, `params`, `scale`, `timeout`) now live under a `metadata` key in SKILL.md. Top-level fields `description`, `license`, and `compatibility` remain at the top level as they are allowed by the external platform. This is a breaking change to the SKILL.md format — existing SKILL.md files must be updated to the new structure.
