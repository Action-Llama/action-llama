---
"@action-llama/action-llama": minor
---

Remove `--no-docker` option and enforce container isolation. Docker container isolation is now mandatory for all agent execution to strengthen the product's security model. The `--no-docker` flag and `local.enabled = false` configuration option have been removed. Closes #53.