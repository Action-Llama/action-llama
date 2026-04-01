---
"@action-llama/action-llama": patch
---

Add `conclusions` field to GitHub webhook trigger validation and filter building. Previously, using `conclusions` in a GitHub webhook trigger config caused `al doctor` to report it as an unrecognized field. The field is now accepted during validation and correctly mapped when building the webhook filter.
