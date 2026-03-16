---
"@action-llama/action-llama": patch
---

Added preflight steps system for declarative data staging before agent runs.
Define `[[preflight]]` steps in `agent-config.toml` to clone repos, fetch URLs,
or run shell commands — all inside the container after credentials load but
before the LLM session starts. Three built-in providers: `shell`, `http`, and
`git-clone`. Params support `${VAR}` env var interpolation. Steps marked
`required: false` log a warning and continue on failure. Closes #85.
