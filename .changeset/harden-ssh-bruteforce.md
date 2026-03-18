---
"@action-llama/action-llama": patch
---

Harden SSH on provisioned VPS servers to block brute-force attacks. New servers
get hardened at boot via cloud-init; existing servers are hardened on the next
`al push`. Disables password authentication, restricts root login to key-only,
and installs fail2ban.
