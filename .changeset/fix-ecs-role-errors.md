---
"@action-llama/action-llama": patch
---

Improved error messages for ECS IAM role assumption failures. When an agent fails to start because its task role doesn't exist or can't be assumed, Action Llama now provides clear instructions to run 'al doctor -c' to create the missing per-agent IAM roles. Closes #34.