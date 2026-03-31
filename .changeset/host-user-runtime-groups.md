---
"@action-llama/action-llama": minor
---

Add `groups` field to `AgentRuntimeType` for host-user runtime Docker socket access

The `[runtime]` table in `agents/<name>/config.toml` now accepts a `groups` array
that specifies additional OS groups the agent process should run with. When set, the
host-user runtime passes `-g <group>` to `sudo` so the agent gains access to resources
protected by that group (e.g. the Docker socket requires the `docker` group).

Example `config.toml` for an agent that needs Docker access:

```toml
[runtime]
type = "host-user"
groups = ["docker"]
```

The `al doctor` command now also validates that any explicitly-configured groups exist
on the system, warning if a configured group is not found.

This fixes the e2e-coverage-improver agent's inability to run `npm run test:e2e` due
to the Docker socket being inaccessible when running as `al-agent` without docker group
membership.
