---
"@action-llama/action-llama": minor
---

Replace `[SILENT]` signal with `[RERUN]` to make reruns opt-in instead of opt-out.
Previously, any run that completed without `[SILENT]` was treated as productive work
and triggered reruns — meaning errors, rate limits, and empty responses caused unwanted
reruns. Now the safe default is no rerun; agents must explicitly emit `[RERUN]` to
request an immediate rerun for backlog draining. Added a top-level Signals section to
AGENTS.md so new projects document `[RERUN]`, `[STATUS]`, and `[TRIGGER]` prominently.
