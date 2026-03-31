---
"@action-llama/action-llama": patch
---

Fix hot-reload not updating HostUserRuntime when agent runtime config changes

When an agent's `config.toml` is modified at runtime (e.g. adding `groups = ["docker"]` to the `[runtime]` section), the hot-reload watcher now correctly:

1. Creates a new `HostUserRuntime` with the updated configuration (runAs user and groups)
2. Updates `agentRuntimeOverrides` so future agent launches use the new runtime
3. Calls `setRuntime` on all existing runners in the pool so even in-flight or next-queued runs pick up the change

Previously, the watcher updated the `AgentConfig` but left the old `HostUserRuntime` instance (without the docker group) in place, causing Docker socket access failures for agents that gained `groups = ["docker"]` via a live config edit.
