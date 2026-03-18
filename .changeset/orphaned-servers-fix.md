---
"@action-llama/action-llama": patch
---

Fixed Hetzner server ID not being saved to the environment file during provisioning.
When provisioning was interrupted (Ctrl+C), `al env deprov` could not delete the
Hetzner server because `hetznerServerId` and `hetznerLocation` were missing from the
persisted config. Both fields are now written in the early `onInstanceCreated` callback
and the final write, matching the existing Vultr behavior.
