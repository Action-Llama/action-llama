---
"@action-llama/action-llama": patch
---

`al push` now sets up nginx as a reverse proxy in front of the gateway during
server bootstrap. The gateway binds to localhost only — nginx handles external
traffic on port 80 and forwards to the gateway. ufw is configured to allow
HTTP/HTTPS if active.
