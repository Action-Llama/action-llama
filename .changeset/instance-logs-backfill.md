---
"@action-llama/frontend": patch
---

Fix instance logs to load all entries for completed instances. Auto-backfill older log entries as soon as the page loads for completed instances, while keeping the existing cursor-based tail-follow behaviour for running instances. This ensures users see the complete log history instead of just the last 100-200 entries.
