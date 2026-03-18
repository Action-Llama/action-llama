---
"@action-llama/action-llama": patch
---

Removed hardcoded `--cpus 2` default from Docker container launch, fixing failures on
single-CPU VPS instances. CPU limit is now only passed when explicitly set via `[local].cpus`
in config. Also removed redundant `size=2g` tmpfs cap since `--memory` already bounds
container memory usage.
