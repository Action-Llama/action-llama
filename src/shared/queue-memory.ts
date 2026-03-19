import { randomUUID } from "crypto";
import type { Queue, QueueItem } from "./queue.js";

/**
 * In-memory Queue implementation.
 *
 * Suitable for tests and single-process local use where durability
 * is not required. State is lost when the process exits.
 */
export class MemoryQueue<T> implements Queue<T> {
  private items: QueueItem<T>[] = [];

  async enqueue(payload: T): Promise<string> {
    const id = randomUUID();
    this.items.push({ id, payload, enqueuedAt: Date.now() });
    return id;
  }

  async dequeue(limit = 1): Promise<QueueItem<T>[]> {
    return this.items.splice(0, limit);
  }

  async peek(limit = 1): Promise<QueueItem<T>[]> {
    return this.items.slice(0, limit);
  }

  async size(): Promise<number> {
    return this.items.length;
  }

  async close(): Promise<void> {
    this.items = [];
  }
}
