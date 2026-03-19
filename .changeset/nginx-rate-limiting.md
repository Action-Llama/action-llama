---
"@action-llama/action-llama": patch
---

Added nginx rate limiting to VPS deployments to protect the gateway from overload. The nginx configuration now includes rate limiting of 5 requests per second per IP address with a burst allowance of 10 requests. Clients exceeding the rate limit receive HTTP 429 responses. Closes #141.