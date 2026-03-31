---
"@action-llama/action-llama": patch
---

Fix manual triggers being recorded as "schedule" type. When clicking "Run" without a prompt, the trigger type was incorrectly inferred from prompt presence. Now uses an explicit trigger parameter.
