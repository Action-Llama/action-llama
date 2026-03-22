---
"@action-llama/action-llama": patch
---

Allow `al push --headless --no-creds` to skip credential validation in doctor.
Previously, headless mode would fail if required credentials were missing locally,
even when `--no-creds` was passed to skip credential syncing. This enables CI/CD
deploy workflows that only push code and agent configs without needing credentials
on the runner.
