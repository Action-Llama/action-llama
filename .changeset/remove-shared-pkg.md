---
"@action-llama/action-llama": patch
---

Remove `@action-llama/shared` workspace package — shared code (log-format) is now inlined into consuming packages, fixing npm install failures for published builds.
