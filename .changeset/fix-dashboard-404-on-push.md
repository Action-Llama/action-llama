---
"@action-llama/action-llama": patch
---

Fix dashboard returning 404 after `al push`. The frontend SPA is now bundled
into the published package so `resolveFrontendDist()` works outside the monorepo.
Nginx config is updated on every push (not just when syncing credentials), and
`/dashboard/api/` routes are proxied correctly instead of being caught by the
SPA catch-all.
