---
"@action-llama/action-llama": patch
---

Fix cloud deploy: create AWS service-linked roles for ECS and App Runner during
`al cloud setup`, include base agent Dockerfile in scheduler image so the
scheduler can verify image caches at runtime, and fix build context to use copies
instead of symlinks for cross-filesystem compatibility.
