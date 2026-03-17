---
"@action-llama/action-llama": patch
---

Added VPS cloud provider (`provider: "vps"`) for deploying agents to any server via SSH + Docker.
Supports connecting to existing servers or provisioning new Vultr VPS instances. Images are built
directly on the VPS via `tar | ssh docker build` — no container registry needed. Credentials are
stored on the VPS filesystem over SSH.
