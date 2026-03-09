---
"@action-llama/action-llama": patch
---

Added configurable scale for agents. Set `scale` in agent-config.toml to control concurrent runs per agent (defaults to 1). This allows dev agents to tackle multiple issues in parallel and reviewers to handle multiple PRs simultaneously. Includes full test coverage and documentation. Closes #39.