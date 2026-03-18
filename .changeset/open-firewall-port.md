---
"@action-llama/action-llama": patch
---

`al push` now automatically opens the gateway port in ufw when the firewall is active.
Previously the gateway would bind to 0.0.0.0 but remain unreachable because ufw
blocked the port.
