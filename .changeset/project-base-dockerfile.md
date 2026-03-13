---
"@action-llama/action-llama": patch
---

Added project-level Dockerfile for customizing the shared base image. `al new` now
scaffolds a `Dockerfile` at the project root that extends `al-agent:latest`. Users can
add system packages, environment variables, or CLI tools that all agents in the project
share. When the project Dockerfile has customizations beyond the bare `FROM`, the build
pipeline creates an intermediate `al-project-base:latest` image; when unmodified, the
extra build step is skipped entirely with zero overhead.
