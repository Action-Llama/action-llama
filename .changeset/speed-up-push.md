---
"@action-llama/action-llama": patch
---

Speed up `al push` by multiplexing SSH connections (ControlMaster), parallelizing rsync and
setup operations, batching small SSH commands, and skipping `npm install` when dependencies
haven't changed. Adds `--force-install` flag to bypass the dependency cache. Repeat pushes
with no dependency changes should complete significantly faster.
