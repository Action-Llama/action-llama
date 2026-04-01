---
"@action-llama/action-llama": patch
---

Optimize /api/stats/activity endpoint to fetch rows, total, and enrichment in a single database pass.

- Replace queryActivityRows + countActivityRows with a new queryActivityRowsWithTotal method that uses COUNT(*) OVER() and LEFT JOIN for inline webhook enrichment
- Remove post-query enrichment loop that called getWebhookDetailsBatch, reducing database round-trips from 2+ to 1
- Maintain stable pagination and identical API response shape (closes #537)
