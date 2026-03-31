---
"@action-llama/frontend": patch
---

Centralize frontend polling into a single `usePolling` hook so that interval management, in-flight guards, abort signals, and cleanup are handled consistently across all pages.
