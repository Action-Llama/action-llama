---
"@action-llama/action-llama": patch
---

Remove redundant `--creds-only`, `--files-only`, and `--all` flags from `al push`. The `--skip-creds` flag is sufficient since push only syncs two things (files and credentials) and there's no real use case for syncing only credentials without files.
