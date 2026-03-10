---
"@action-llama/action-llama": patch
---

Added `ecr:SetRepositoryPolicy` to the operator IAM policy in the ECS docs.
This permission is required by `al doctor -c` to grant Lambda image pull access
on the ECR repository.
