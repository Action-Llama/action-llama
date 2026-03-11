---
"@action-llama/action-llama": patch
---

Added agent instance management and scheduler control commands. The new functionality includes:

- `al status` now shows running agent instances with unique IDs and scheduler pause state
- `al kill <instance-id>` allows killing a specific running agent instance
- `al pause` pauses the scheduler to prevent new runs from starting
- `al resume` resumes the scheduler after being paused

All management commands require the gateway to be running (start scheduler with `-g` flag). Instance IDs are generated with the format `{agentName}-{timestamp}-{randomHex}` and are displayed in the status output. Closes #62.