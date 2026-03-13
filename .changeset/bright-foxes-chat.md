---
"@action-llama/action-llama": patch
---

Added agent-scoped interactive mode to `al chat`. Running `al chat <agent>` loads the
agent's credentials as environment variables (GITHUB_TOKEN, GIT_SSH_COMMAND, etc.) and
opens an interactive session in the agent's directory. Use `-c` to load credentials from
the cloud secrets manager instead of the local filesystem. The agent's ACTIONS.md is
provided as reference context but is not auto-executed. A warning is shown if the gateway
is not reachable, since resource locks, agent calls, and signals require a running gateway.
