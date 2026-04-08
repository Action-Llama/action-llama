---
"@action-llama/action-llama": patch
---

Fix log summarize endpoint using wrong credential resolution path, causing 401 errors. The endpoint now uses the same AuthStorage pipeline as agent runners, checking all credential sources (runtime overrides, auth.json, OAuth with auto-refresh, env vars) instead of only one based on authType. Empty API keys now return a 500 with an actionable error message instead of silently hitting Anthropic.
