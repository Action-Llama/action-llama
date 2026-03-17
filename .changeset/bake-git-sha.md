---
"@action-llama/action-llama": patch
---

Bake git SHA into `dist/build-info.json` at build time so Docker image tags are
consistent across npm installs. Previously, `GIT_SHA` was computed at runtime via
`git rev-parse`, which returned the user's project SHA instead of the package's,
busting the local Docker image cache on every commit. Also switched the Dockerfile
syntax directive from Docker Hub to the ECR mirror to avoid rate-limit failures
in CodeBuild.
