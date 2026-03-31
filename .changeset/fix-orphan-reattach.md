---
"@action-llama/action-llama": patch
---

Fix HostUserRuntime orphan reattachment after scheduler restart. Previously,
adopted orphan processes failed immediately because waitForExit and streamLogs
had no handle to the process spawned by the previous scheduler. Now stdio is
directed to the log file (not pipes) so child processes survive restarts, and
reattach() reconstructs in-memory state from PID files. All methods (streamLogs,
waitForExit, kill) follow a single code path for both fresh and adopted processes.
