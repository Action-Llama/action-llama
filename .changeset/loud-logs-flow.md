---
"@action-llama/action-llama": patch
---

Grant CloudWatch Logs read permissions to the operator IAM user during `al cloud setup`.
Previously, `al logs` would fail with an authorization error because the setup wizard
only granted `iam:PassRole`. The new `ActionLlamaOperator` inline policy includes
`logs:FilterLogEvents` and `logs:GetLogEvents` on both ECS and Lambda log groups.
