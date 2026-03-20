---
"@action-llama/action-llama": patch
---

Add missing test script to action-llama package.json to fix CI failure.

The prepublishOnly hook was failing during npm publish because it tried to run `npm test`, but no test script was defined in the package-level package.json after the monorepo restructuring. This adds a test script that runs vitest with the local config file.

Closes #198