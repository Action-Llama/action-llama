---
"@action-llama/action-llama": patch
---

`al doctor` now checks whether host-user runtime agents' system user is in the `docker` group. It warns if the user is missing from the group and, on Linux, attempts to fix it automatically with `sudo usermod -aG docker <user>`.
