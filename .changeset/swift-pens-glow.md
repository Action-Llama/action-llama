---
"@action-llama/action-llama": patch
---

Fix activity page filter changes causing request storms. Memoize status filters to prevent reset-offset effect from firing on every SSE-driven render, and add key-change debouncing to useQuery so rapid checkbox toggles coalesce into a single fetch.
