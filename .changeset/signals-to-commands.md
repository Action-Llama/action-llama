---
"@action-llama/action-llama": minor
---

Migrated signal system from text-pattern markers to file-based shell commands. Agents now use `al-rerun`, `al-status "<text>"`, `al-return`, and `al-exit [code]` commands instead of `[RERUN]`, `[STATUS: text]`, `[RETURN]...[/RETURN]`, and `[EXIT: code]` text patterns. The old `[TRIGGER: agent]...[/TRIGGER]` pattern was already superseded by `al-call`. Commands write signal files to `$AL_SIGNAL_DIR` and optionally POST to the gateway for real-time TUI updates. This is more robust than text scanning and aligns with the existing command pattern used by `rlock`, `al-call`, and `al-shutdown`. Closes #51.
