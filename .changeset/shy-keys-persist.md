---
"@action-llama/action-llama": patch
---

Fixed VPS SSH key credential not being persisted during Vultr provisioning.
When creating a new SSH key via `al env prov`, the generated keypair was uploaded
to Vultr but never saved to the local credential store, making it unrecoverable.
The key is now persisted to `~/.action-llama/credentials/vps_ssh/default/` before
uploading to Vultr.
