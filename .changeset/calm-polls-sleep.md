---
"@action-llama/action-llama": patch
---

Fix 429 errors in dashboard by reducing frontend polling frequency and adding retry-with-backoff. Log polling slowed from 1.5–2s to 3–4s (10s when instance is finished), lock polling from 2s to 5s. fetchJSON now retries up to 2 times on HTTP 429 with exponential backoff respecting the Retry-After header.
