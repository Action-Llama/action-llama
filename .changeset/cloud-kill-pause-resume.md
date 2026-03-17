---
"@action-llama/action-llama": patch
---

Added `--cloud` (`-c`) flag to `al kill`, `al pause`, and `al resume` commands.
`kill -c` stops running cloud tasks directly via ECS/Cloud Run APIs.
`pause -c` and `resume -c` forward to the cloud-deployed scheduler's gateway.
Also added `runtimeId` field to `RunningAgent` to store full cloud identifiers
needed for kill operations (ECS task ARN, Cloud Run execution path).
