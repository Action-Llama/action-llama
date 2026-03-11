---
"@action-llama/action-llama": minor
---

Changed signal system from text-pattern markers to explicit commands. Signals now use `al-rerun`, `al-status "<text>"`, and `al-trigger <agent> "<context>"` commands instead of `[RERUN]`, `[STATUS: text]`, and `[TRIGGER: agent]...[/TRIGGER]` patterns. This makes the signal system more robust and aligns with the existing resource locking command pattern. Closes #51.