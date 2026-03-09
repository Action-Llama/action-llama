---
"@action-llama/action-llama": patch
---

`al doctor -c` now automatically grants `iam:PassRole` to the calling IAM user
for Lambda and ECS task roles. This fixes "not authorized to perform iam:PassRole"
errors when launching Lambda agents.
