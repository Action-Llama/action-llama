---
"@action-llama/action-llama": patch
---

Fix release workflow failing because `prepublishOnly` called `npm test` which doesn't exist in the workspace package. Build and test now run explicitly at the monorepo root in CI before publishing.
