---
"@action-llama/action-llama": patch
---

Added resource locking for agents running with `scale > 1`. Agents can use LOCK/UNLOCK
skills in their playbook to coordinate concurrent instances and prevent them from working
on the same resource. The gateway exposes lock endpoints and accepts a configurable
`gateway.lockTimeout` in `config.toml`.
