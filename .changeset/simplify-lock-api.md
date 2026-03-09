---
"@action-llama/action-llama": patch
---

Simplified the resource lock API from two parameters to one. `LOCK("resource", "key")` is now `LOCK("resourceKey")` — e.g. `LOCK("github issue acme/app#42")`. The same change applies to `UNLOCK()` and `HEARTBEAT()`. The HTTP endpoints now accept a single `resourceKey` field instead of separate `resource` and `key` fields.
