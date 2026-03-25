---
"@action-llama/action-llama": patch
---

Rewrite `al config` to use raw config instead of resolved config, preventing crashes when an agent references an undefined model. The config TUI now shows a checklist with status indicators (✓/✗/-) for each field, letting users see and fix validation issues interactively instead of hitting a fatal error.
