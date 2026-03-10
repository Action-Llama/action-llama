---
"@action-llama/action-llama": patch
---

Set `HOME=/tmp` in container entry so that child processes (like the agent harness)
that write to `$HOME` (e.g. `git config --global`) work on Lambda's read-only filesystem.
