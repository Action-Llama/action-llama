---
"@action-llama/action-llama": patch
---

Cleaned up `al start` output: credential checks are now silent on startup unless
something is missing, and the TUI header shows a visible "Scheduler paused"
indicator when the scheduler is paused.
