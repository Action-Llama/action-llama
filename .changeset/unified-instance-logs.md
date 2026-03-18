---
"@action-llama/action-llama": patch
---

Consolidated per-instance log files into a single file per agent. Scaled agent instances
now write to one shared log file (e.g. `dev-2024-03-18.log`) with an `instance` field
to distinguish entries, instead of separate files per instance (`dev-2-2024-03-18.log`).
The `al logs` command and gateway API filter by instance field when viewing a specific
instance. Also starts and stops the Docker gateway proxy container as part of the
scheduler lifecycle, and fixes the proxy "already running" detection.
