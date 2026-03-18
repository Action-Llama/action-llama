---
"@action-llama/action-llama": patch
---

`al push` now runs `npm install` on the remote server after syncing project files,
ensuring dependencies (including `al` itself) stay up to date with each deploy.
The `al` CLI is no longer installed globally on the server — it is resolved from
the project's `node_modules/.bin/al` instead.
