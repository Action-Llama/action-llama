---
"@action-llama/action-llama": patch
---

Docker images are now tagged with git SHA (primary), semver, and latest instead of
only `:latest`. The git SHA tag is immutable and used for builds and deployments,
making rollbacks deterministic and debugging easier. OCI labels
(`org.opencontainers.image.revision`, `org.opencontainers.image.version`) are baked
into the base image so `docker inspect` shows which commit built a running container.
