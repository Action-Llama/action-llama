---
"@action-llama/action-llama": patch
---

`al push` now configures nginx as a TLS reverse proxy using the Cloudflare Origin CA
certificate created during provisioning. The gateway binds to localhost only — nginx
terminates TLS on port 443 and forwards to the gateway. Removed `--expose` from the
systemd unit since the gateway should not be directly reachable from the internet.
