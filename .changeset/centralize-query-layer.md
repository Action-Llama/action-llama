---
"@action-llama/action-llama": patch
---

Fix dashboard 529 errors and glitchiness by centralizing SSE, invalidation, and data fetching into a unified query layer.

**Server-side:** Replace destructive `flushInvalidations()` with version-cursored invalidation log so multiple SSE clients (browser tabs) each receive all signals.

**Frontend:** Replace per-component `useInvalidation`/`usePolling`/manual `load()` patterns with a centralized `useQuery` hook backed by a query cache and signal bus. This eliminates double-fetches (ActivityPage's dual invalidation hooks), adds in-flight request guards, and replaces native EventSource auto-reconnect with exponential backoff to prevent 529 storms under load.
