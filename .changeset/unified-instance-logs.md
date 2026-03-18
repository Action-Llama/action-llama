---
"@action-llama/action-llama": patch
---

Consolidated per-instance log files into a single file per agent. All instances now
write to one shared log file (e.g. `dev-2024-03-18.log`) with an `instance` field
to distinguish entries, instead of separate files per instance. Instance IDs are now
per-run random identifiers (e.g. `dev-a1b2c3d4`) instead of static scale indices
(`dev(1)`), making it easy to trace individual runs. The `al logs --instance` flag
accepts the run suffix or full instance ID. Also starts and stops the Docker gateway
proxy container as part of the scheduler lifecycle.
