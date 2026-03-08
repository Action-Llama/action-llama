---
"@action-llama/action-llama": patch
---

Added configurable parallelism for agents. Set `parallelism` in agent-config.toml to control concurrent runs per agent (defaults to 1). This allows dev agents to tackle multiple issues in parallel and reviewers to handle multiple PRs simultaneously. Includes full test coverage and documentation. Closes #39.