---
"@action-llama/action-llama": patch
---

Unify trigger history across the dashboard and agent detail page. The agent page's "Instance History" is replaced with "Recent Triggers" (5 most recent, paginated, with "View all" linking to a full agent-filtered trigger history page). Agent names now show their assigned color in all trigger tables. The `/api/stats/triggers` endpoint accepts an optional `?agent=<name>` filter.
