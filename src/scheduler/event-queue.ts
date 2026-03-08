export interface QueuedEvent {
  agentType: string;
  text: string;
  timestamp: string;
}

export type EventListener = (event: QueuedEvent) => void;

export class EventQueue {
  private listeners: EventListener[] = [];

  onEvent(listener: EventListener): void {
    this.listeners.push(listener);
  }

  push(event: QueuedEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

// --- Bounded per-agent webhook event queue ---

export interface QueuedWebhookEvent<T> {
  context: T;
  receivedAt: Date;
}

export interface EnqueueResult<T> {
  accepted: boolean;
  dropped?: QueuedWebhookEvent<T>;
}

export class WebhookEventQueue<T> {
  private queues = new Map<string, QueuedWebhookEvent<T>[]>();
  private maxSize: number;

  constructor(maxSize = 20) {
    this.maxSize = maxSize;
  }

  enqueue(agentName: string, context: T, receivedAt?: Date): EnqueueResult<T> {
    let queue = this.queues.get(agentName);
    if (!queue) {
      queue = [];
      this.queues.set(agentName, queue);
    }
    let dropped: QueuedWebhookEvent<T> | undefined;
    if (queue.length >= this.maxSize) {
      dropped = queue.shift();
    }
    queue.push({ context, receivedAt: receivedAt || new Date() });
    return { accepted: true, dropped };
  }

  dequeue(agentName: string): QueuedWebhookEvent<T> | undefined {
    const queue = this.queues.get(agentName);
    if (!queue || queue.length === 0) return undefined;
    return queue.shift();
  }

  size(agentName: string): number {
    return this.queues.get(agentName)?.length ?? 0;
  }

  clear(agentName: string): void {
    this.queues.delete(agentName);
  }

  clearAll(): void {
    this.queues.clear();
  }
}
