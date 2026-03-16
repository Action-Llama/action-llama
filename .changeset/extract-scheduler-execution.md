---
"@action-llama/action-llama": patch
---

Extracted core scheduling logic (executeRun, dispatchTriggers, drainQueues, runWithReruns)
from scheduler/index.ts into a new scheduler/execution.ts module. This separates pure
scheduling logic from startup orchestration, enabling focused unit tests without
infrastructure mocks.
