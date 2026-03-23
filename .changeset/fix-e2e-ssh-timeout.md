---
"@action-llama/action-llama": patch
---

Fix E2E test SSH service startup timeout. Enhanced VPS container debugging with detailed startup logging, improved SSH connection timeout handling, and added health checks. Addresses SSH service failing to start within the 60-attempt timeout that was blocking all deployment-related E2E tests. Closes #318.