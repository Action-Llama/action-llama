---
"@action-llama/action-llama": patch
---

Improve dashboard and TUI layout, fix several bugs:

- Dashboard: remove stat cards, add side-by-side agent table + triggers layout, session time in token panel title, paused banner disables Run buttons, dropdown action menu on mobile, remove Recent Activity section
- Dashboard: fix duplicate state text ("idleidle") in scaled agents, add trigger type column back to triggers table, use consistent uppercase table headers
- Agent detail: move config section to skill page, add scale control and Kill button to header, fix running instances not clearing after completion
- Skill page: show full agent configuration (schedule, models, credentials, webhook filters with all fields) above skill markdown with proper section headers
- Instance page: fix locks not displaying (backend now returns `holder` field), add trigger type badge
- TUI: show project scale in header
- Frontend-wide: standardize instance ID display with ellipsis format (first 4 + … + last 4), ellipsis for long agent names on mobile
