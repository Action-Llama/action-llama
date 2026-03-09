---
"@action-llama/action-llama": patch
---

Fixed resource locking across all execution modes. Cloud containers (ECS/Cloud Run)
now register with the gateway for lock coordination — previously all lock requests
from cloud containers returned 403. Lock holders are now instance-specific (e.g.
"my-agent-1", "my-agent-2") so agents with scale > 1 can each hold their own lock
instead of conflicting on a shared agent name. Added startup warnings when cloud mode
is missing `gateway.url` and when `scale > 1` is used without Docker.
