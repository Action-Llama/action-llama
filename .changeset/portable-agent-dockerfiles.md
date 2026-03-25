---
"@action-llama/action-llama": patch
---

Stop scaffolding a project-level Dockerfile in `al new`. Agent-level Dockerfiles
are now the recommended approach since they keep agents self-contained and portable
across projects. Project Dockerfiles are still supported but discouraged in docs.
