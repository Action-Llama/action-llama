/**
 * Integration tests: SchedulerEventBus — no Docker required.
 *
 * SchedulerEventBus is a typed event bus used for scheduler lifecycle events.
 * It wraps Node.js EventEmitter with a typed interface and adds helpers like
 * waitFor() and collect() for test instrumentation.
 *
 * Tests exercise all public API methods without starting the scheduler or
 * requiring Docker:
 *   - emit / on — basic typed event emission and subscription
 *   - once — one-time listener fires once then is removed
 *   - off — removes a specific listener
 *   - removeAllListeners — clears all listeners
 *   - waitFor — resolves when matching event is received
 *   - waitFor with predicate — only resolves when predicate returns true
 *   - waitFor timeout — rejects after timeout when no matching event
 *   - collect — accumulates events until stop() is called
 *
 * Covers:
 *   - scheduler/events.ts: SchedulerEventBus (all public methods)
 */

import { describe, it, expect } from "vitest";
import { SchedulerEventBus } from "@action-llama/action-llama/internals/scheduler-events";

describe("scheduler-event-bus: SchedulerEventBus", { timeout: 30_000 }, () => {
  it("on() receives emitted events of the correct type", () => {
    const bus = new SchedulerEventBus();
    const received: string[] = [];

    bus.on("run:start", (data) => {
      received.push(data.agentName);
    });

    bus.emit("run:start", {
      agentName: "my-agent",
      instanceId: "inst-1",
      trigger: "manual",
    });

    expect(received).toEqual(["my-agent"]);
  });

  it("on() receives multiple events in order", () => {
    const bus = new SchedulerEventBus();
    const received: string[] = [];

    bus.on("run:end", (data) => {
      received.push(`${data.agentName}:${data.result}`);
    });

    bus.emit("run:end", { agentName: "agent-a", instanceId: "i1", result: "completed" });
    bus.emit("run:end", { agentName: "agent-b", instanceId: "i2", result: "error" });

    expect(received).toEqual(["agent-a:completed", "agent-b:error"]);
  });

  it("once() fires once and is automatically removed", () => {
    const bus = new SchedulerEventBus();
    let count = 0;

    bus.once("run:start", () => { count++; });

    bus.emit("run:start", { agentName: "agent-c", instanceId: "i3", trigger: "schedule" });
    bus.emit("run:start", { agentName: "agent-c", instanceId: "i4", trigger: "schedule" });

    // Should only fire once
    expect(count).toBe(1);
  });

  it("off() removes a specific listener", () => {
    const bus = new SchedulerEventBus();
    let count = 0;

    const handler = () => { count++; };
    bus.on("run:start", handler);

    bus.emit("run:start", { agentName: "agent-d", instanceId: "i5", trigger: "manual" });
    expect(count).toBe(1);

    bus.off("run:start", handler);
    bus.emit("run:start", { agentName: "agent-d", instanceId: "i6", trigger: "manual" });

    // Should not fire after off()
    expect(count).toBe(1);
  });

  it("removeAllListeners() removes all listeners", () => {
    const bus = new SchedulerEventBus();
    let count = 0;

    bus.on("run:start", () => { count++; });
    bus.on("run:end", () => { count++; });

    bus.removeAllListeners();

    bus.emit("run:start", { agentName: "agent-e", instanceId: "i7", trigger: "manual" });
    bus.emit("run:end", { agentName: "agent-e", instanceId: "i7", result: "completed" });

    expect(count).toBe(0);
  });

  it("waitFor() resolves when the event is emitted", async () => {
    const bus = new SchedulerEventBus();

    const waitPromise = bus.waitFor("run:start");

    // Emit after a tick to simulate async behavior
    setTimeout(() => {
      bus.emit("run:start", { agentName: "wait-agent", instanceId: "wi1", trigger: "manual" });
    }, 10);

    const data = await waitPromise;
    expect(data.agentName).toBe("wait-agent");
  });

  it("waitFor() with predicate only resolves when predicate returns true", async () => {
    const bus = new SchedulerEventBus();

    const waitPromise = bus.waitFor(
      "run:end",
      (data) => data.agentName === "target-agent",
    );

    setTimeout(() => {
      // This should be filtered out by the predicate
      bus.emit("run:end", { agentName: "other-agent", instanceId: "oi1", result: "completed" });
      // This should match
      bus.emit("run:end", { agentName: "target-agent", instanceId: "ti1", result: "completed" });
    }, 10);

    const data = await waitPromise;
    expect(data.agentName).toBe("target-agent");
  });

  it("waitFor() rejects after timeout when no matching event arrives", async () => {
    const bus = new SchedulerEventBus();

    await expect(
      bus.waitFor("run:start", undefined, 100), // 100ms timeout
    ).rejects.toThrow(/timed out|timeout/i);
  });

  it("collect() accumulates events and returns them on stop()", () => {
    const bus = new SchedulerEventBus();

    const collector = bus.collect("lock");

    bus.emit("lock", {
      agentName: "lock-agent",
      instanceId: "li1",
      resourceKey: "github://repo/1",
      action: "acquire",
      ok: true,
      status: 200,
    });
    bus.emit("lock", {
      agentName: "lock-agent",
      instanceId: "li1",
      resourceKey: "github://repo/2",
      action: "release",
      ok: true,
      status: 200,
    });

    const events = collector.stop();
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe("acquire");
    expect(events[1].action).toBe("release");
  });

  it("collect() stops accumulating after stop() is called", () => {
    const bus = new SchedulerEventBus();

    const collector = bus.collect("run:start");

    bus.emit("run:start", { agentName: "c-agent", instanceId: "c1", trigger: "schedule" });
    const events = collector.stop();

    // Emit after stop — should not be in results
    bus.emit("run:start", { agentName: "c-agent", instanceId: "c2", trigger: "schedule" });

    expect(events).toHaveLength(1);
    expect(events[0].instanceId).toBe("c1");
  });

  it("multiple event types can be listened to independently", () => {
    const bus = new SchedulerEventBus();
    const startEvents: string[] = [];
    const endEvents: string[] = [];

    bus.on("run:start", (d) => startEvents.push(d.instanceId));
    bus.on("run:end", (d) => endEvents.push(d.instanceId));

    bus.emit("run:start", { agentName: "multi-agent", instanceId: "m1", trigger: "manual" });
    bus.emit("run:end", { agentName: "multi-agent", instanceId: "m1", result: "completed" });
    bus.emit("run:start", { agentName: "multi-agent", instanceId: "m2", trigger: "schedule" });

    expect(startEvents).toEqual(["m1", "m2"]);
    expect(endEvents).toEqual(["m1"]);
  });
});
