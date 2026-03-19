---
"@action-llama/action-llama": patch
---

Resource locks are now durable. `LockStore` persists acquired locks to the
SQLite state store so they survive process restarts. The backing store uses
a generic `StateStore` interface that can be swapped for a different backend
(e.g. PostgreSQL) in the future without changing `LockStore`. Closes #157.
