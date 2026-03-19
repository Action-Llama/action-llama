---
"@action-llama/action-llama": patch
---

Added `--headless` flag to `al push` command for non-interactive mode. When used, the doctor runs in check-only mode without prompting to fix credential issues. Default behavior now runs doctor interactively to allow fixing issues during push. Closes #186.