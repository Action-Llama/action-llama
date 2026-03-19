---
"@action-llama/action-llama": patch
---

Deploy only required credentials instead of entire credentials directory. The `al push` command now selectively syncs only the credentials actually needed by project agents, plus implicit credentials like gateway_api_key. This improves security by ensuring deployments only have access to required credentials. Closes #184.