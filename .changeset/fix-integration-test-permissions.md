---
"@action-llama/action-llama": patch
---

Fix integration tests failing due to restrictive credential file permissions. Use more permissive permissions (0755 for directories, 0644 for files) in test mode while maintaining security with restrictive permissions (0700/0400) in production. Closes #234.