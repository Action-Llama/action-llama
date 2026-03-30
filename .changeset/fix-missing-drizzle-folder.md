---
"@action-llama/action-llama": patch
---

Fix startup crash (`Can't find meta/_journal.json`) by including the `drizzle/` migrations folder in the published npm package. Previously the folder was missing from the `files` array in `package.json`, so database migrations failed at runtime.
