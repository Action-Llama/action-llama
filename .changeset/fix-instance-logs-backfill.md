---
"@action-llama/action-llama": patch
---

Fix instance logs not showing full history: stop backfill only when server indicates no more data (not based on batch size), and fix forward cursor to track actual bytes consumed so entries aren't skipped between polls.
