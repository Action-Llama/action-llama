---
"@action-llama/action-llama": patch
---

Fixed `al logs -c` returning the oldest log entries instead of the newest.
CloudWatch's FilterLogEvents API returns events oldest-first, so `al logs -c`
was showing stale logs. Now uses GetLogEvents with `startFromHead: false` on
the most recent log streams for true tail behavior. Also fixed Lambda's
follow mode (`-f`) to track position with nextToken instead of re-fetching
the same events every poll cycle.
