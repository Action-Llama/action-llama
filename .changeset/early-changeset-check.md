---
"@action-llama/action-llama": patch
---

Move changeset check before npm install/build/test in the release workflow so the workflow exits early when there are no changesets, avoiding unnecessary CI time.
