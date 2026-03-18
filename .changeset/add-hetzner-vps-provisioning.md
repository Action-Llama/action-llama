---
"@action-llama/action-llama": patch
---

Added support for Hetzner VPS provisioning alongside existing Vultr support. 
Users can now provision Hetzner Cloud servers via `al setup cloud` with the 
same Cloudflare HTTPS integration. Requires a `hetzner_api_key` credential.
Closes #119.