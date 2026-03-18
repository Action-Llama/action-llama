---
"@action-llama/action-llama": patch
---

Fixed VPS SSH key credential not being persisted during Vultr provisioning, and
SSH polling using the wrong key path. When creating or selecting a vps_ssh
credential, the keypair is now saved to the credential store and `sshKeyPath` is
stored in the environment config so that SSH connections use the correct key.

VPS cloud-init now installs Node.js 22.x LTS in addition to Docker, so
`al push` no longer fails with "Node.js not found" on freshly provisioned
servers. Running `al env prov` on an existing environment now verifies SSH,
Node.js, and Docker readiness (installing Node.js automatically if missing)
instead of silently skipping.
