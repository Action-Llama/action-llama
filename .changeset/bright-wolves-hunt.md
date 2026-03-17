---
"@action-llama/action-llama": patch
---

Added `al env set`, `al env prov`, and `al env deprov` commands for binding projects to environments, provisioning VPS servers, and tearing them down. Provisioned servers now get a ufw firewall configured (SSH + gateway only). Removed the unused `al setup` command and dead `cloud-setup.ts` code.
