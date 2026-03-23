---
"@action-llama/action-llama": patch
---

Fix E2E tests Docker network connectivity by restoring explicit network connection calls. This resolves the regression introduced in commit 2987ecc where containers were not properly connecting to the custom network, causing SSH connection timeouts and scheduler startup failures. Closes #313.