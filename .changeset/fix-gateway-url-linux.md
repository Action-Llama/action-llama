---
"@action-llama/action-llama": patch
---

Fixed container gateway URL fallback to use the nginx proxy (`http://gateway:8080`) on the
Docker network instead of `host.docker.internal`, which doesn't resolve on Linux. This broke
`rlock`, `runlock`, and other gateway-dependent commands inside containers on VPS deployments.
