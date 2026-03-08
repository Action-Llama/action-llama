---
"@action-llama/action-llama": patch
---

Fixed gateway startup timing to show build status instead of 502 errors. When running `al start -c -H -w` (cloud mode with headless and web UI), the gateway now starts before Docker images are built, allowing users to see build progress on the dashboard instead of getting 502 errors. Closes #37.