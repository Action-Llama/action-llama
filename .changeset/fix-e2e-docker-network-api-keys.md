---
"@action-llama/action-llama": patch
---

Fix E2E test Docker network IP assignment and API key configuration issues. Increased container startup timeout from 2000ms to 5000ms to allow proper network setup and added test API keys to E2E workflow to prevent model provider initialization failures. Closes #303.