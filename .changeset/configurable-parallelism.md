---
"@action-llama/action-llama": minor
---

Added configurable parallelism for agents. Set `parallelism = N` in agent-config.toml to run multiple instances of the same agent concurrently. Allows dev agents to tackle issues in parallel and reviewers to handle multiple PRs simultaneously. Defaults to 1 for backward compatibility. Closes #39.