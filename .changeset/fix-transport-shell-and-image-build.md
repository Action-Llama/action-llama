---
"@action-llama/action-llama": patch
---

Fix transport runner shell compatibility and add Docker image build pipeline.

- Switch all transports (Docker exec, SSH, host-user) from `bash` to POSIX `sh` so containers without bash (e.g. Alpine) work correctly — fixes "Timed out waiting for shell response" errors.
- Build project-level and agent-specific Docker images before provisioning containers, so custom packages from Dockerfiles (github-cli, ripgrep, etc.) are available at runtime.
- Add image caching: skip rebuilds when the git-SHA-tagged image already exists.
