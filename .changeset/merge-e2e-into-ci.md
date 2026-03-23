---
"@action-llama/action-llama": patch
---

Merged the standalone E2E workflow into the CI workflow. E2E tests now run
in parallel with unit/integration tests, and both must pass before triggering
a deploy. The CI workflow also gains concurrency grouping and workflow_dispatch.
