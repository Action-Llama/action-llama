---
"@action-llama/action-llama": minor
---

Replace agent shell commands with Pi tools. The old shell commands (`al-export`, `al-rerun`, `al-status`, `al-return`, `al-exit`, `al-shutdown`, `al-subagent`, `al-subagent-check`, `al-subagent-wait`, `rlock`, `runlock`, `rlock-heartbeat`) have been removed. Agents now use scheduler tools (`acquire_lock`, `release_lock`, `call_agent`, `check_call`, `set_status`, `return_value`, `wait_for_trigger`) provided directly as LLM tool calls. The `docker/bin/` directory and all gateway routes that serviced shell commands have been removed.
