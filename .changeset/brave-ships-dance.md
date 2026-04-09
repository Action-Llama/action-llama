---
"@action-llama/action-llama": patch
---

Fix Docker transport failing on Alpine/BusyBox containers by replacing tar-based batch file I/O with per-file `docker cp`. BusyBox tar lacks GNU flags (`-P`, `--ignore-failed-read`) that the batch path relied on.
