/**
 * Event-sourced WorkQueue using unified persistence layer.
 * 
 * Replaces table-based queue with event stream per agent, providing
 * natural audit trails and replay capabilities for all queued work.
 */

import type { PersistenceStore } from "../shared/persistence/index.js";
import { createEvent, EventTypes, EventStreamWrapper } from "../shared/persistence/event-store.js";
import type { WorkQueue, QueuedWorkItem, EnqueueResult } from "./event-queue.js";

export class EventSourcedWorkQueue<T> implements WorkQueue<T> {
  private agentStreams = new Map<string, EventStreamWrapper>();
  private queueState = new Map<string, QueueState<T>>();
  private maxSize: number;

  constructor(
    private persistence: PersistenceStore,
    maxSize: number = 100
  ) {
    this.maxSize = maxSize;
  }

  private getAgentStream(agentName: string): EventStreamWrapper {
    if (!this.agentStreams.has(agentName)) {
      const stream = new EventStreamWrapper(
        this.persistence.events.stream(`work-queue-${agentName}`)
      );
      this.agentStreams.set(agentName, stream);
    }
    return this.agentStreams.get(agentName)!;
  }

  private async getQueueState(agentName: string): Promise<QueueState<T>> {
    if (!this.queueState.has(agentName)) {
      const state = await this.buildQueueState(agentName);
      this.queueState.set(agentName, state);
    }
    return this.queueState.get(agentName)!;
  }

  private async buildQueueState(agentName: string): Promise<QueueState<T>> {
    const stream = this.getAgentStream(agentName);
    const state = new QueueState<T>();
    
    // Replay events to build current queue state
    for await (const event of stream.replay()) {
      switch (event.type) {
        case EventTypes.WORK_QUEUED:
          state.enqueue({
            context: event.data.context,
            receivedAt: new Date(event.data.receivedAt),
          });
          break;
        case EventTypes.WORK_DEQUEUED:
          state.dequeue(event.data.workId);
          break;
        case EventTypes.WORK_DROPPED:
          state.drop(event.data.workId);
          break;
      }
    }
    
    return state;
  }

  enqueue(agentName: string, context: T, receivedAt?: Date): EnqueueResult<T> {
    const timestamp = receivedAt || new Date();
    
    // This is async but we need sync interface for compatibility
    // We'll process asynchronously and return optimistic result
    this.enqueueAsync(agentName, context, timestamp).catch(error => {
      console.error(`Failed to enqueue work for ${agentName}:`, error);
    });
    
    return { accepted: true };
  }

  private async enqueueAsync(agentName: string, context: T, receivedAt: Date): Promise<void> {
    const stream = this.getAgentStream(agentName);
    const state = await this.getQueueState(agentName);
    
    const workId = `${agentName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Check if we need to drop oldest item
    let droppedItem: QueuedWorkItem<T> | undefined;
    if (state.size() >= this.maxSize) {
      const oldest = state.getOldest();
      if (oldest) {
        await stream.appendTyped(
          EventTypes.WORK_DROPPED,
          {
            workId: oldest.id,
            reason: "queue-full",
            agentName,
          },
          {
            source: "work-queue",
            actor: agentName,
          }
        );
        
        droppedItem = oldest.item;
        state.drop(oldest.id);
      }
    }
    
    // Add new work item
    await stream.appendTyped(
      EventTypes.WORK_QUEUED,
      {
        workId,
        agentName,
        context,
        receivedAt: receivedAt.getTime(),
      },
      {
        source: "work-queue",
        actor: agentName,
      }
    );
    
    state.enqueue({ context, receivedAt }, workId);
  }

  dequeue(agentName: string): QueuedWorkItem<T> | undefined {
    // This is async but we need sync interface for compatibility
    // We'll use the cached state and process events asynchronously
    const state = this.queueState.get(agentName);
    if (!state) return undefined;
    
    const item = state.peek();
    if (!item) return undefined;
    
    // Async process the dequeue event
    this.dequeueAsync(agentName, item.id).catch(error => {
      console.error(`Failed to record dequeue for ${agentName}:`, error);
    });
    
    return state.dequeue(item.id);
  }

  private async dequeueAsync(agentName: string, workId: string): Promise<void> {
    const stream = this.getAgentStream(agentName);
    
    await stream.appendTyped(
      EventTypes.WORK_DEQUEUED,
      {
        workId,
        agentName,
        dequeuedAt: Date.now(),
      },
      {
        source: "work-queue",
        actor: agentName,
      }
    );
  }

  size(agentName: string): number {
    const state = this.queueState.get(agentName);
    return state ? state.size() : 0;
  }

  clear(agentName: string): void {
    this.clearAsync(agentName).catch(error => {
      console.error(`Failed to clear queue for ${agentName}:`, error);
    });
  }

  private async clearAsync(agentName: string): Promise<void> {
    const state = await this.getQueueState(agentName);
    const stream = this.getAgentStream(agentName);
    
    // Drop all current items
    for (const { id } of state.getAllItems()) {
      await stream.appendTyped(
        EventTypes.WORK_DROPPED,
        {
          workId: id,
          reason: "queue-cleared",
          agentName,
        },
        {
          source: "work-queue",
          actor: agentName,
        }
      );
    }
    
    state.clear();
  }

  clearAll(): void {
    this.clearAllAsync().catch(error => {
      console.error("Failed to clear all queues:", error);
    });
  }

  private async clearAllAsync(): Promise<void> {
    for (const agentName of this.agentStreams.keys()) {
      await this.clearAsync(agentName);
    }
  }

  close(): void {
    this.agentStreams.clear();
    this.queueState.clear();
  }

  // Additional methods for event-sourced features
  
  /**
   * Replay queue events for debugging/audit purposes.
   */
  async replayQueueHistory(agentName: string): Promise<Array<{ type: string; data: any; timestamp: number }>> {
    const stream = this.getAgentStream(agentName);
    const events = [];
    
    for await (const event of stream.replay()) {
      events.push({
        type: event.type,
        data: event.data,
        timestamp: event.timestamp,
      });
    }
    
    return events;
  }

  /**
   * Get queue statistics from events.
   */
  async getQueueStats(agentName: string, since?: number): Promise<{
    totalEnqueued: number;
    totalDequeued: number;
    totalDropped: number;
    currentSize: number;
  }> {
    const stream = this.getAgentStream(agentName);
    let totalEnqueued = 0;
    let totalDequeued = 0;
    let totalDropped = 0;
    
    for await (const event of stream.replay({ from: since })) {
      switch (event.type) {
        case EventTypes.WORK_QUEUED:
          totalEnqueued++;
          break;
        case EventTypes.WORK_DEQUEUED:
          totalDequeued++;
          break;
        case EventTypes.WORK_DROPPED:
          totalDropped++;
          break;
      }
    }
    
    return {
      totalEnqueued,
      totalDequeued,
      totalDropped,
      currentSize: this.size(agentName),
    };
  }

  /**
   * Initialize queue state from events on startup.
   */
  async initialize(): Promise<void> {
    // Get all existing work queue streams
    const streams = await this.persistence.events.listStreams();
    const workQueueStreams = streams.filter(name => name.startsWith("work-queue-"));
    
    for (const streamName of workQueueStreams) {
      const agentName = streamName.replace("work-queue-", "");
      await this.getQueueState(agentName); // This will build state from events
    }
  }
}

/**
 * Internal queue state management.
 */
class QueueState<T> {
  private items = new Map<string, { item: QueuedWorkItem<T>; order: number }>();
  private orderCounter = 0;

  enqueue(item: QueuedWorkItem<T>, id?: string): string {
    const workId = id || `work-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.items.set(workId, { item, order: this.orderCounter++ });
    return workId;
  }

  dequeue(workId?: string): QueuedWorkItem<T> | undefined {
    if (workId) {
      const entry = this.items.get(workId);
      if (entry) {
        this.items.delete(workId);
        return entry.item;
      }
      return undefined;
    }
    
    // Get oldest item
    const oldest = this.getOldest();
    if (oldest) {
      this.items.delete(oldest.id);
      return oldest.item;
    }
    
    return undefined;
  }

  peek(): { id: string; item: QueuedWorkItem<T> } | undefined {
    return this.getOldest();
  }

  getOldest(): { id: string; item: QueuedWorkItem<T> } | undefined {
    let oldestId: string | undefined;
    let oldestOrder = Infinity;
    
    for (const [id, { order }] of this.items.entries()) {
      if (order < oldestOrder) {
        oldestOrder = order;
        oldestId = id;
      }
    }
    
    if (oldestId) {
      const entry = this.items.get(oldestId);
      return entry ? { id: oldestId, item: entry.item } : undefined;
    }
    
    return undefined;
  }

  drop(workId: string): boolean {
    return this.items.delete(workId);
  }

  size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getAllItems(): Array<{ id: string; item: QueuedWorkItem<T>; order: number }> {
    return Array.from(this.items.entries()).map(([id, data]) => ({
      id,
      item: data.item,
      order: data.order,
    }));
  }
}