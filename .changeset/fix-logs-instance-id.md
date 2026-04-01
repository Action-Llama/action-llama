---
"@action-llama/action-llama": patch
---

Fix `al logs <instanceid>` returning no entries when gateway is running. The CLI was incorrectly constructing the API path with just the instance suffix instead of the full instance ID, causing the gateway to not match log entries. Closes #534
