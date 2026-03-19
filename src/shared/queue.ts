/**
 * Queue — durable ordered FIFO queue with a swappable backend.
 *
 * Items are dequeued in insertion order (FIFO).
 * The interface is intentionally minimal so it can be backed by
 * SQLite (local), PostgreSQL (cloud), or an in-memory store (tests).
 */

export interface QueueItem<T = unknown> {
  /** Opaque unique identifier assigned at enqueue time. */
  id: string;
  /** The enqueued value. */
  payload: T;
  /** Unix milliseconds when the item was enqueued. */
  enqueuedAt: number;
}

export interface Queue<T = unknown> {
  /**
   * Append a payload to the tail of the queue.
   * Returns the assigned item ID.
   */
  enqueue(payload: T): Promise<string>;

  /**
   * Remove and return up to `limit` items from the head (FIFO order).
   * Defaults to 1. Returns an empty array when the queue is empty.
   */
  dequeue(limit?: number): Promise<QueueItem<T>[]>;

  /**
   * Return up to `limit` items from the head without removing them.
   * Defaults to 1. Returns an empty array when the queue is empty.
   */
  peek(limit?: number): Promise<QueueItem<T>[]>;

  /** Return the number of items currently in the queue. */
  size(): Promise<number>;

  /** Release resources (close DB connection, clear timers, etc.). */
  close(): Promise<void>;
}

// --- Factory ---

export interface SqliteQueueOpts {
  type: "sqlite";
  /** Path to the .db file (created if missing). */
  path: string;
  /** Queue name — allows multiple queues in one SQLite file. */
  name: string;
}

export interface MemoryQueueOpts {
  type: "memory";
}

export type QueueOpts = SqliteQueueOpts | MemoryQueueOpts;

/**
 * Create a Queue from configuration.
 *
 * Uses dynamic imports so native modules (better-sqlite3) are only
 * loaded when actually needed.
 */
export async function createQueue<T>(opts: QueueOpts): Promise<Queue<T>> {
  if (opts.type === "sqlite") {
    const { SqliteQueue } = await import("./queue-sqlite.js");
    return new SqliteQueue<T>(opts.path, opts.name);
  }
  const { MemoryQueue } = await import("./queue-memory.js");
  return new MemoryQueue<T>();
}
