---
"@action-llama/action-llama": patch
---

Fixed gateway proxy container name collision when multiple scheduler instances run
concurrently. The proxy container name now includes the gateway port
(`al-gateway-proxy-<port>`) instead of using a static name, preventing Docker
name conflicts in parallel test runs and multi-instance scenarios.
