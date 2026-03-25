---
"@action-llama/action-llama": patch
---

Namespace VPS server names by environment to prevent naming collisions when provisioning multiple environments on the same provider account. Servers are now named `action-llama-<envName>` instead of the hardcoded `action-llama`. Environment names are validated at creation time (lowercase alphanumeric + hyphens, max 50 chars). On teardown, shared provider firewalls are automatically deleted when no other action-llama servers reference them.
