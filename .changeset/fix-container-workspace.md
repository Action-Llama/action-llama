---
"@action-llama/action-llama": patch
---

Fix container agents hanging on startup: use `/tmp` as working directory instead of nonexistent `/workspace`, drain stdout in Docker build to prevent pipe deadlock, and log tool errors at warn level so they appear in `al logs`.
