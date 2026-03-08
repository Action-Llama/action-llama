---
"@action-llama/action-llama": patch
---

Added ability to stop and start agents in the TUI. Use ↑/↓ arrow keys to select agents and 
Space to enable/disable them. Disabled agents skip scheduled runs and ignore webhook events. 
The TUI shows enabled/disabled state and tracks counts in the header. Closes #43.