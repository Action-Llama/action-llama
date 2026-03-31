---
"@action-llama/action-llama": patch
---

Merge the Triggers and Jobs pages into a unified Activity page. The new Activity page shows pending queue items, running instances, completed jobs, errors, and dead letters all in one view, sorted by timestamp. A Status filter replaces the dead-letters checkbox, and all existing /triggers and /jobs URLs redirect to /activity. Agent detail pages link to /activity?agent=X.

Also adds a `peek()` method to the WorkQueue interface (MemoryWorkQueue, SqliteWorkQueue, EventSourcedWorkQueue) to expose queued items without consuming them, enabling pending items to appear as rows in the Activity feed.
