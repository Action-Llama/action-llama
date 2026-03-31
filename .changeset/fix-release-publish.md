---
"@action-llama/action-llama": patch
---

Fix release workflow: split npm publish into separate steps so that a failure publishing @action-llama/skill does not block @action-llama/action-llama.
