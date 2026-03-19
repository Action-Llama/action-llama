---
"@action-llama/action-llama": patch
---

Added single-agent push support: `al push <agent>` syncs only that agent's
files to the remote server. The running scheduler's file watcher detects the
change and hot-reloads the agent without restarting the service or disrupting
other agents. Closes #169.
