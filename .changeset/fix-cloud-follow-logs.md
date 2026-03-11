---
"@action-llama/action-llama": patch
---

Fixed `al logs -f -c` for AWS Lambda and ECS. Follow mode previously required a
running task to be detected via `listRunningAgents`, which always returned empty
for Lambda and missed short-lived ECS tasks. Now polls CloudWatch directly by
agent name, so follow works regardless of whether a task is currently running.
