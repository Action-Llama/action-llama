---
"@action-llama/action-llama": patch
---

Fix missing assistant text in `host-user` runtime logs. Output emitted between `launch()` and `streamLogs()` was silently dropped because `pipe()` put the stream into flowing mode immediately. Lines are now buffered from process start and replayed when `streamLogs()` attaches. Closes #380.
