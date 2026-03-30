---
"@action-llama/action-llama": patch
---

Refactor scheduler startup into explicit phases. Extract `dependencies.ts`, `persistence.ts`, and `orphan-recovery.ts` from `scheduler/index.ts` for independent testability. No behavior changes.
