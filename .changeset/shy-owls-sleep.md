---
"@action-llama/action-llama": patch
---

Fix EACCES permission error when containers read mounted credentials on VPS deployments. The SSH runtime now sets ownership of the credential staging directory to the container UID/GID after writing files, matching the behavior of the local runtime.
