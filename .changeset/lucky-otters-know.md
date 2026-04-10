---
"@action-llama/skill": patch
---

Fix the skill package build so it runs on Node 20 without the `--experimental-strip-types` flag. `npm run build` now invokes a plain JavaScript build-docs script, which keeps the repo build working on the declared Node engine.
