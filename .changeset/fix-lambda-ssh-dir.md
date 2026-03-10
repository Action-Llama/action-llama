---
"@action-llama/action-llama": patch
---

Fixed container entry crashing on Lambda due to hardcoded `/home/node/.ssh` path.
The SSH directory now uses `$HOME` (falling back to `/tmp`), so it works in Lambda
where the home directory is not `/home/node`.
