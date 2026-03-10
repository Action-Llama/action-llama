---
"@action-llama/action-llama": patch
---

Fix Lambda agents re-running endlessly when there's no work to do. The `[SILENT]`
marker was missed due to a race between CloudWatch log polling and exit detection,
causing every run to be treated as "completed" (did work) instead of "silent" (no work).
Lambda's `waitForExit` now scans for `[SILENT]` in the same logs it reads for the
REPORT line, and returns exit code 42 which the container runner treats as silent.
