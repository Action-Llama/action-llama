---
"@action-llama/action-llama": patch
---

Fixed Lambda and ECS environment variable key validation errors when credential
instance names contain hyphens or other special characters. Keys like
`AL_SECRET_github__my-org__token` are now encoded to comply with AWS's
`[a-zA-Z][a-zA-Z0-9_]+` constraint.
