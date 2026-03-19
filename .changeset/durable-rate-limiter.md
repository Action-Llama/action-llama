---
"@action-llama/action-llama": patch
---

The webhook rate limiter now persists hit counts to the SQLite state store so
that limits survive process restarts. When a `StateStore` is provided to the
gateway (which is always the case in normal operation), rate-limit state is
durable; without a store it falls back to the existing in-memory behavior.
Closes #157.
