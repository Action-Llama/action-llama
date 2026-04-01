---
"@action-llama/action-llama": minor
---

Optimize `/api/stats/activity` endpoint with SQL-level pagination instead of fetching all rows into memory. Adds `queryActivityRows` and `countActivityRows` methods to `StatsStore`, pushes filtering and pagination down to SQLite, and adds an index on `runs.result`. Running/pending items still appear at the top of page 1 only. This eliminates the O(n) full-table scan on every activity page load.
