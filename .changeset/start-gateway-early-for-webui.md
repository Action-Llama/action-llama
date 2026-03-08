---
"@action-llama/action-llama": patch
---

Fixed dashboard availability during image builds. When using `al start -c -H -w`, the gateway server now starts immediately so the dashboard is accessible while Docker images are building, preventing 502 errors. Closes #37.