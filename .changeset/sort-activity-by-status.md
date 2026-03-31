---
"@action-llama/action-llama": patch
---

Sort agent activity feed by status group (pending → running → completed/error) then by timestamp descending within each group. Also removes the status badge from the agent detail page header since the activity table provides sufficient status information. Closes #464.
