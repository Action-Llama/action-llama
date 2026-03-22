---
"@action-llama/action-llama": minor
---

Breaking: Remove automatic initial run of scheduled agents on startup

Agents with schedules no longer run automatically when the service starts.
They will only run on their configured schedule or when manually triggered.
This prevents overwhelming the system on startup when many agents are configured.