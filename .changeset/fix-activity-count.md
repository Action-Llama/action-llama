---
"@action-llama/action-llama": patch
---

fix: use countActivityRows instead of queryActivityRowsWithTotal(limit=0) to get accurate activity count

When the /api/stats/activity endpoint's page was filled entirely by in-memory rows (running/pending agents), the code would call queryActivityRowsWithTotal with limit=0. SQLite returns an empty result set for LIMIT 0, so the window function COUNT(*) OVER() could not be accessed, causing total to always be 0.

The fix uses the existing countActivityRows() method which correctly counts all activity rows without the LIMIT 0 issue.
