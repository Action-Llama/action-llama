---
"@action-llama/action-llama": patch
---

`al doctor` now collects all validation errors and displays them together instead of failing on the first problem. Uses raw runtime config to avoid crashing on undefined model references, letting it report all issues at once.
