---
"@action-llama/e2e": patch
---

Fix E2E tests to use per-agent config.toml for runtime fields (models, credentials, schedule) instead of SKILL.md frontmatter metadata, matching the new config system. Also fix browser SSE test selector to match the updated navbar connection indicator.
