---
"@action-llama/action-llama": patch
---

Suppress false ERROR logs when containers are intentionally killed during shutdown.
Added an `_aborting` flag to `ContainerAgentRunner` so that exit code 137 (SIGKILL)
after an `abort()` call logs at info level instead of error. Also fixed the cmd-rerun
integration test to use `maxReruns: 1`, preventing leftover containers from being
killed during teardown.
