---
"@action-llama/action-llama": patch
---

Added a durable `Queue<T>` abstraction backed by SQLite. The generic `Queue` interface (`enqueue`, `dequeue`, `peek`, `size`) is designed to be swappable — a `MemoryQueue` is provided for tests and single-process use, and `SqliteQueue` persists items across restarts with atomic FIFO dequeue. Use `createQueue({ type: "sqlite", path, name })` to create a named queue within the project's existing state database. Closes #157.
