---
"@action-llama/action-llama": patch
---

Remove built-in rate limiting from the gateway. Rate limiting is now handled exclusively by nginx when deployed to a VPS (5 req/sec per IP with burst of 10), which is more appropriate for publicly exposed deployments. Local development instances no longer have rate limiting, which is fine since they are not publicly exposed. Closes #161.
