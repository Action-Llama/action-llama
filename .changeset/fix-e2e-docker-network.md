---
"@action-llama/action-llama": patch
---

Fixed Docker network IP assignment failure in E2E tests. Containers were incorrectly connecting to the default bridge network instead of the custom `action-llama-e2e` network due to improper `NetworkMode` configuration. Moved `NetworkMode` to `HostConfig` and added explicit network connection after container start to ensure proper network attachment. Closes #309.