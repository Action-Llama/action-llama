---
"@action-llama/action-llama": patch
---

`al cloud setup` now grants `iam:PassRole` on `al-*` roles and `iam:PutUserPolicy`
(self) to the calling IAM user during initial setup. `al doctor -c` also attempts
to update PassRole grants when roles change. Fixes "not authorized to perform
iam:PassRole" errors when launching Lambda agents.
