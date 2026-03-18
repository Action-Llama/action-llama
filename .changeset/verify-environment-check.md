---
"@action-llama/action-llama": patch
---

Added `al env check <name>` to verify environment health (SSH, Node.js, Docker, Vultr firewall, Cloudflare DNS, nginx, SSL mode, gateway). Reports pass/fail for each check and suggests `al env prov <name>` to fix issues. Re-running `al env prov` on an existing environment now uses the same verification logic with auto-fix.
