---
"@action-llama/action-llama": patch
---

Add missing `groups = ["docker"]` to e2e-coverage-improver agent config

The `e2e-coverage-improver` agent's `config.toml` was missing the `groups = ["docker"]`
field that was introduced in PR #426. Without it, the agent runs without Docker group
membership and cannot connect to `/var/run/docker.sock`, causing all e2e test runs to
fail with `EACCES /var/run/docker.sock`. Closes #427.
