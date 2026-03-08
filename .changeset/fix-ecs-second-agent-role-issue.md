---
"@action-llama/action-llama": patch
---

Fixed second agent ECS role assumption failures with improved validation and error handling. The scheduler now validates IAM task roles exist before starting, and provides better error messages when ECS cannot assume roles. Closes #34.