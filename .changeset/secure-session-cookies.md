---
"@action-llama/action-llama": patch
---

Fix security issue where the raw API key was stored in the browser session cookie. Login now creates an opaque server-side session ID (64-char hex from 32 random bytes) stored in the StateStore, and only that ID is placed in the cookie. Logout invalidates the session server-side. Falls back to direct cookie comparison when no StateStore is configured (backward compatibility). Closes #151.
