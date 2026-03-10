---
"@action-llama/action-llama": patch
---

Fix Lambda agents failing with "Request must be smaller than 5120 bytes" on
UpdateFunctionConfiguration. Secrets are now passed in the invoke payload
(256 KB limit) instead of as environment variables (4 KB limit), which also
ensures each agent can only see its own configured credentials.
