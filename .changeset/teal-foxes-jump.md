---
"@action-llama/action-llama": patch
---

Remove internal transport re-export shims from `src/transport/`. Consumers now import directly from `@action-llama/pi-remote`.
