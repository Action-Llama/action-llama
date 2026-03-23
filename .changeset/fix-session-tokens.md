---
"@action-llama/action-llama": patch
---

Fix session token counts always showing 0 on the dashboard. The pi-coding-agent SDK returns token data under `stats.tokens` (e.g., `stats.tokens.input`) but `sessionStatsToUsage()` was only checking `stats.usage`. Cost displayed correctly because `stats.cost` matched an existing fallback path.
