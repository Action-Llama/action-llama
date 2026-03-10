---
"@action-llama/action-llama": patch
---

Fixed Lambda failing to pull ECR images by setting an ECR repository policy
granting `lambda.amazonaws.com` pull access. Unlike ECS (which uses IAM role
permissions), Lambda requires an explicit resource policy on the ECR repository.
The policy is now applied during `al cloud init` and `al doctor -c`.
