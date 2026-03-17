---
"@action-llama/action-llama": patch
---

Fixed GitHub webhook `orgs` filter being silently ignored. The `buildFilterFromTrigger` function
now correctly passes `orgs` through to the filter. Also added `org` as a convenience shorthand
for `orgs` (e.g., `org = "acme"` instead of `orgs = ["acme"]`), and `al doctor` now validates
webhook trigger fields and rejects unrecognized keys with helpful suggestions.
