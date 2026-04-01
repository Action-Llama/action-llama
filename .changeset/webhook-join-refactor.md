---
"@action-llama/action-llama": patch
---

API: Join webhook_receipts metadata at SQL level instead of post-processing. The /api/stats/activity endpoint now uses a LEFT JOIN in the SQL query to populate triggerSource and eventSummary fields directly, eliminating the need for a separate batch query call. This improves performance on activity requests while maintaining backward-compatible behavior (eventSummary is suppressed when it equals source).
