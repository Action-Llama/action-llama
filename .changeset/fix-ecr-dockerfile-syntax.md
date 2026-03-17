---
"@action-llama/action-llama": patch
---

Remove `# syntax=public.ecr.aws/docker/dockerfile:1` directive from Dockerfile.
The ECR public mirror doesn't carry the BuildKit frontend image, causing CodeBuild
Docker builds to fail. BuildKit is already the default builder, so the directive
is unnecessary.
