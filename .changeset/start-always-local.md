---
"@action-llama/action-llama": patch
---

Make `al start` always run locally regardless of environment. Previously it would attempt to start a remote service via SSH when the active environment had a `[server]` section, blocking local development.
