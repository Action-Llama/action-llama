---
"@action-llama/action-llama": patch
---

Remove dead code in execution/routes/locks.ts — the invalid URI scheme branch was unreachable since `new URL()` already rejects URIs with invalid schemes (e.g. `123://...`) by throwing, which is caught by the existing catch block.
