---
"@action-llama/action-llama": patch
---

Fix instance detail page to show proper status for running instances instead of misleading "Instance not found" message. The page now displays telemetry availability message and running instance information when an agent is currently executing. Closes #205