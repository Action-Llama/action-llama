import { describe, it, expect, vi } from "vitest";
import { EventQueue, WebhookEventQueue } from "../../src/scheduler/event-queue.js";

describe("EventQueue", () => {
  it("notifies listeners when event is pushed", () => {
    const queue = new EventQueue();
    const listener = vi.fn();
    queue.onEvent(listener);

    const event = { agentType: "dev", text: "test", timestamp: new Date().toISOString() };
    queue.push(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it("notifies multiple listeners", () => {
    const queue = new EventQueue();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    queue.onEvent(listener1);
    queue.onEvent(listener2);

    const event = { agentType: "reviewer", text: "review", timestamp: new Date().toISOString() };
    queue.push(event);

    expect(listener1).toHaveBeenCalledWith(event);
    expect(listener2).toHaveBeenCalledWith(event);
  });

  it("does nothing with no listeners", () => {
    const queue = new EventQueue();
    // Should not throw
    queue.push({ agentType: "devops", text: "poll", timestamp: new Date().toISOString() });
  });
});

describe("WebhookEventQueue", () => {
  it("enqueues and dequeues in FIFO order", () => {
    const queue = new WebhookEventQueue<string>();
    queue.enqueue("agent-a", "event-1");
    queue.enqueue("agent-a", "event-2");

    expect(queue.dequeue("agent-a")?.context).toBe("event-1");
    expect(queue.dequeue("agent-a")?.context).toBe("event-2");
    expect(queue.dequeue("agent-a")).toBeUndefined();
  });

  it("isolates queues per agent", () => {
    const queue = new WebhookEventQueue<string>();
    queue.enqueue("agent-a", "a-event");
    queue.enqueue("agent-b", "b-event");

    expect(queue.size("agent-a")).toBe(1);
    expect(queue.size("agent-b")).toBe(1);
    expect(queue.dequeue("agent-a")?.context).toBe("a-event");
    expect(queue.dequeue("agent-b")?.context).toBe("b-event");
  });

  it("drops oldest event when queue is full", () => {
    const queue = new WebhookEventQueue<string>(3);
    queue.enqueue("agent-a", "event-1");
    queue.enqueue("agent-a", "event-2");
    queue.enqueue("agent-a", "event-3");

    const result = queue.enqueue("agent-a", "event-4");
    expect(result.dropped?.context).toBe("event-1");
    expect(queue.size("agent-a")).toBe(3);
    expect(queue.dequeue("agent-a")?.context).toBe("event-2");
  });

  it("returns accepted: true even when dropping", () => {
    const queue = new WebhookEventQueue<string>(1);
    queue.enqueue("agent-a", "event-1");
    const result = queue.enqueue("agent-a", "event-2");
    expect(result.accepted).toBe(true);
    expect(result.dropped?.context).toBe("event-1");
  });

  it("returns no dropped event when queue has space", () => {
    const queue = new WebhookEventQueue<string>(5);
    const result = queue.enqueue("agent-a", "event-1");
    expect(result.accepted).toBe(true);
    expect(result.dropped).toBeUndefined();
  });

  it("size returns 0 for unknown agent", () => {
    const queue = new WebhookEventQueue<string>();
    expect(queue.size("unknown")).toBe(0);
  });

  it("dequeue returns undefined for unknown agent", () => {
    const queue = new WebhookEventQueue<string>();
    expect(queue.dequeue("unknown")).toBeUndefined();
  });

  it("sets receivedAt timestamp on enqueue", () => {
    const queue = new WebhookEventQueue<string>();
    const before = new Date();
    queue.enqueue("agent-a", "event-1");
    const after = new Date();
    const event = queue.dequeue("agent-a")!;
    expect(event.receivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(event.receivedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("clear removes all events for an agent", () => {
    const queue = new WebhookEventQueue<string>();
    queue.enqueue("agent-a", "event-1");
    queue.enqueue("agent-a", "event-2");
    queue.clear("agent-a");
    expect(queue.size("agent-a")).toBe(0);
    expect(queue.dequeue("agent-a")).toBeUndefined();
  });

  it("clearAll removes all agents' queues", () => {
    const queue = new WebhookEventQueue<string>();
    queue.enqueue("agent-a", "a-event");
    queue.enqueue("agent-b", "b-event");
    queue.clearAll();
    expect(queue.size("agent-a")).toBe(0);
    expect(queue.size("agent-b")).toBe(0);
  });

  it("clearInMemory clears in-memory state without touching the store", () => {
    const mockStore = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const queue = new WebhookEventQueue<string>(100, mockStore as any);
    queue.enqueue("agent-a", "a-event");
    queue.enqueue("agent-b", "b-event");

    // Reset mock counts after enqueue calls (which trigger persist -> set)
    mockStore.delete.mockClear();
    mockStore.deleteAll.mockClear();

    queue.clearInMemory();

    expect(queue.size("agent-a")).toBe(0);
    expect(queue.size("agent-b")).toBe(0);
    expect(mockStore.delete).not.toHaveBeenCalled();
    expect(mockStore.deleteAll).not.toHaveBeenCalled();
  });
});
