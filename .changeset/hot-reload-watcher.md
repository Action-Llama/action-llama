---
"@action-llama/action-llama": patch
---

Added hot reload for `al start`. The scheduler now watches the `agents/` directory
for changes and automatically reloads agent configs, rebuilds images, and updates
cron/webhook schedules without restarting. Running containers finish with their old
image; new runs use the updated image. Adding or removing agent directories is also
detected automatically.
