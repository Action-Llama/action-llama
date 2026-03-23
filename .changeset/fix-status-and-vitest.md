---
"@action-llama/action-llama": patch
---

Fix `al stat` crash when displaying running instances (`startedAt` from JSON is a string, not a Date) and exclude Playwright `.spec.ts` files from vitest so they don't fail the test suite.
