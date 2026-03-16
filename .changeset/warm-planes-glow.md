---
"@action-llama/action-llama": patch
---

`al doctor -c` now reconciles the App Runner instance role's inline policy to match the
current code. Previously, infrastructure-level IAM policies (like DynamoDB permissions on
`al-apprunner-instance-role`) could only be updated by re-running the full `al cloud init`
provisioning wizard. The scheduler policy document is now defined in a single shared
function to prevent drift between provisioning and reconciliation.
