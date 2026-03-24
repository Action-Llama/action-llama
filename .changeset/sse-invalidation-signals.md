---
"@action-llama/action-llama": patch
---

Fix SSE streaming through Cloudflare proxies by adding `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers to the status stream endpoint. Add per-agent invalidation signals so dashboard pages automatically re-fetch data (triggers, runs, stats, config) when mutations occur, instead of only updating on initial page load.
