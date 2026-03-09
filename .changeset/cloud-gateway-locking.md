---
"@action-llama/action-llama": patch
---

Fixed cloud agents (ECS/Cloud Run) not receiving GATEWAY_URL and SHUTDOWN_SECRET
env vars, which prevented locking and coordination. Cloud containers can now reach
the gateway by setting `gateway.url` in config.toml to the public gateway URL.
