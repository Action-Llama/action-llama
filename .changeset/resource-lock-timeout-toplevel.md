---
"@action-llama/action-llama": patch
---

Moved lock timeout config from `gateway.lockTimeout` to top-level `resourceLockTimeout`
for clarity. The setting controls how long resource locks live before expiring (default
1800s / 30 minutes). The old `gateway.lockTimeout` field is no longer recognized.
