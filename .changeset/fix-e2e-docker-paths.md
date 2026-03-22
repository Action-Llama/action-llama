---
"@action-llama/action-llama": patch
---

Fixed E2E test Docker build context paths. Corrected relative paths in harness.ts
from `./packages/e2e/docker/local` and `./packages/e2e/docker/vps` to `./docker/local`
and `./docker/vps` to resolve correctly when vitest runs from the packages/e2e directory.
Fixes CI failures where E2E tests were timing out due to missing Dockerfiles.
Closes #242.