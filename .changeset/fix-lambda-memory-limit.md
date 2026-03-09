---
"@action-llama/action-llama": patch
---

Fixed Lambda memory limit error by lowering the default from 4096 MB to 512 MB
and clamping to Lambda's 3008 MB maximum. Previously, the uncapped 4096 MB default
caused `MemorySize value failed to satisfy constraint` errors on every Lambda invocation.
