---
"@action-llama/action-llama": patch
---

Fix instance logs page missing entries older than ~1 hour. Log API now reads across multiple daily log files instead of only the latest, cursor forward-reads correctly span date boundaries, and the frontend `limit` param is fixed to match the backend `lines` param.
