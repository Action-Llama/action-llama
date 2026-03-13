---
"@action-llama/action-llama": patch
---

Optimize cloud deploy image builds with multiple caching strategies: CodeBuild local
Docker layer cache, stable cache tags with `--cache-from`, direct ECR image assembly
for thin agents (bypasses CodeBuild entirely), batched CodeBuild jobs for heavy agents,
and a multi-stage scheduler Dockerfile that caches npm install separately from code changes.
