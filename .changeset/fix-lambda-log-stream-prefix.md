---
"@action-llama/action-llama": patch
---

Fixed `al logs -c` failing for Lambda-backed agents with a validation error about empty `logStreamNamePrefix`. The empty string is now omitted from the CloudWatch API call.
