---
"@action-llama/action-llama": patch
---

Removed `server.gatewayPort` config option. The remote gateway port is now
always 3000 (`DEFAULT_GATEWAY_PORT`), matching what UFW, nginx, and Vultr
firewall rules already assumed. Also removed the unused `AL_GATEWAY_PORT`
environment variable from the systemd unit.
