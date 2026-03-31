---
"@action-llama/action-llama": patch
---

Fix e2e-coverage-improver config.toml to include complete configuration

PR #428 created the config.toml with only the `[runtime]` section, missing the
`models`, `credentials`, `schedule`, `timeout`, and `[params]` fields required
for the agent to run correctly. This restores the full configuration including
`groups = ["docker"]` so the agent has Docker socket access.
