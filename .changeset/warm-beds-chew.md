---
"@action-llama/action-llama": patch
---

Fix permission denied error when loading credentials in local Docker containers. The intermediate type directory (e.g. `/credentials/anthropic_key/`) was not chowned to the container user, causing EACCES on scandir.
