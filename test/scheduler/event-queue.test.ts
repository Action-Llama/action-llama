import { describe, it, expect, vi } from "vitest";
import { EventQueue } from "../../src/scheduler/event-queue.js";

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
