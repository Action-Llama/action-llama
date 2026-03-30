---
"@action-llama/action-llama": patch
---

Introduce Drizzle ORM as the data access layer for all SQLite operations. Consolidates the three separate databases (`.al/state.db`, `.al/stats.db`, `.al/work-queue.db`) into a single `.al/action-llama.db` managed by Drizzle migrations. On startup, pending migrations are applied automatically and existing data from legacy databases is migrated transparently. Existing `.db` files are backed up to `.al/backups/<timestamp>/` before migration. Closes #398.
