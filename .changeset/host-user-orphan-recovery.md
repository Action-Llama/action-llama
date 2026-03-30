---
"@action-llama/action-llama": patch
---

Add orphan recovery for HostUserRuntime (no-Docker mode). Previously, if the
scheduler crashed or restarted while a HostUserRuntime agent was running, the
orphaned process was invisible to the new scheduler — leading to zombie agents,
duplicate runs, and leaked resources. Now HostUserRuntime writes PID files
alongside each running process, enabling `listRunningAgents()` and
`inspectContainer()` to discover and re-adopt orphans on restart, matching the
resilience of Docker-based runtimes. The scheduler shutdown handler also
terminates tracked child processes on graceful exit.
