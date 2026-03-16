---
"@action-llama/action-llama": patch
---

Fixed `al logs -c -f <instance-id>` producing no output. Cloud log commands now
accept a task/instance ID (from `al stat -c`) in addition to agent names. When an
instance ID is passed, logs are filtered to that specific task's CloudWatch stream.
Added shared `resolveTarget()` so all commands that accept agent-or-instance resolve
consistently.
