---
"@action-llama/action-llama": patch
---

Fix `al logs -c` returning empty results for Lambda-routed agents. The logs command
now uses the same runtime selection logic as the scheduler, routing to LambdaRuntime
(and its CloudWatch log group) for agents with timeout <= 900s.
