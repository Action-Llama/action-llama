---
"@action-llama/action-llama": patch
---

Fix ModelRegistry usage to use static `create()` factory method instead of private constructor, matching upstream pi-coding-agent API change.
