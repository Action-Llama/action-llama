---
"@action-llama/action-llama": patch
---

Fixed `al env deprov` not destroying Hetzner servers. The `ServerConfig` type was
missing `hetznerServerId` and `hetznerLocation` fields, so they were silently
dropped when loading the environment config and never passed to the teardown function.
