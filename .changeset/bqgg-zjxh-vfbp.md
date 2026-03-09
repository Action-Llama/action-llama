---
"@action-llama/action-llama": patch
---

Improved local Docker build caching. Added `.dockerignore` to exclude `node_modules`,
`.git`, `src/`, `test/`, and other non-build files from the build context. Enabled
BuildKit explicitly and added an npm cache mount so `npm install` layers are reused
even when `package.json` changes.
