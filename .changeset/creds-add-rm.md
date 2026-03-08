---
"@action-llama/action-llama": patch
---

Added `al creds add <ref>` and `al creds rm <ref>` commands for managing individual
credentials. `add` runs the interactive prompter with validation; `rm` deletes the
credential from disk. Also improved `al creds ls` to group credentials by type with
a human-readable label header.
