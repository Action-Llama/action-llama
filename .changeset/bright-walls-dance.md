---
"@action-llama/action-llama": patch
---

Standardized `/tmp` as the only writable directory across all platforms. Agents now
receive an `<environment>` block in their prompt documenting the read-only root
filesystem and `/tmp` as the working directory. The container entry point uses `/tmp`
instead of the previous `/workspace` directory, and the local Docker runtime mounts
a single 2GB tmpfs at `/tmp`. This ensures consistent behavior across local Docker,
ECS Fargate, and Cloud Run.
