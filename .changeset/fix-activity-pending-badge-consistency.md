---
"@action-llama/action-llama": patch
---

Fix Activity page pending badge showing stale count inconsistent with the table.

The badge now derives its count from the same API response that populates the table (`pendingCount` field from `/api/stats/activity`), instead of the SSE-pushed `queuedWebhooks` value. This eliminates the race condition where the SSE stream and REST API could return different pending counts, causing the badge to say "1 Pending" while no pending row appeared below. Closes #502.
