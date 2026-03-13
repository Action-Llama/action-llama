---
"@action-llama/action-llama": patch
---

Added missing ECR permissions to the operator IAM policy in ecs.md. The
`assembleImageDirect` path (used for thin agent images) requires
`GetDownloadUrlForLayer`, `PutImage`, `InitiateLayerUpload`,
`UploadLayerPart`, and `CompleteLayerUpload` on the deploy role.
