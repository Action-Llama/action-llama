---
"@action-llama/action-llama": patch
---

Fixed container entry crashing on Lambda due to hardcoded `/home/node/.ssh` path
and read-only `~/.gitconfig`. The SSH directory now uses `$HOME` (falling back to
`/tmp`), and git credential helper uses `GIT_CONFIG_COUNT` env vars instead of
`git config --global`, avoiding filesystem writes in read-only containers.
