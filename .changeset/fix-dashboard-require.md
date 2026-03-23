---
"@action-llama/action-llama": patch
---

Fix dashboard config page crashing with `require is not defined` by replacing the CommonJS `require()` call with a static ESM import for `getProjectScale`.
