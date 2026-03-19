---
"@action-llama/action-llama": patch
---

Improve gateway security by requiring authentication when exposing services. API keys are now required for --web-ui and --expose modes, cookies use the Secure flag for non-localhost connections, and log routes are disabled without authentication. Run 'al doctor' to configure the gateway API key. Closes #183.