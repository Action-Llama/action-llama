---
"@action-llama/action-llama": patch
---

Fix infinite re-render loop (React error #185) on the Activity page by ensuring `getQuerySnapshot` returns referentially stable objects for `useSyncExternalStore`.
