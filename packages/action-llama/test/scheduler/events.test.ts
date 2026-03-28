import { describe, it, expect, vi, beforeEach } from "vitest";
import { SchedulerEventBus } from "../../src/scheduler/events.js";

describe("SchedulerEventBus", () => {
  let bus: SchedulerEventBus;

  beforeEach(() => {
    bus = new SchedulerEventBus();
  });

  describe("emit and on", () => {
    it("delivers run:start event to listener", () => {
      const received: unknown[] = [];
      bus.on("run:start", (data) => received.push(data));

      bus.emit("run:start", { agentName: "agent1", instanceId: "id1", trigger: "cron" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ agentName: "agent1", instanceId: "id1", trigger: "cron" });
    });

    it("delivers run:end event to listener", () => {
      const received: unknown[] = [];
      bus.on("run:end", (data) => received.push(data));

      bus.emit("run:end", { agentName: "agent1", instanceId: "id1", result: "success", exitCode: 0 });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ agentName: "agent1", instanceId: "id1", result: "success", exitCode: 0 });
    });

    it("delivers lock event with all fields", () => {
      const received: unknown[] = [];
      bus.on("lock", (data) => received.push(data));

      bus.emit("lock", { agentName: "agent1", instanceId: "id1", resourceKey: "res://key", action: "acquire", ok: true, status: 200 });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ agentName: "agent1", action: "acquire", ok: true });
    });

    it("delivers call event to listener", () => {
      const received: unknown[] = [];
      bus.on("call", (data) => received.push(data));

      bus.emit("call", { callerAgent: "a1", targetAgent: "a2", ok: true, callId: "c1" });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ callerAgent: "a1", targetAgent: "a2", ok: true });
    });

    it("delivers signal event to listener", () => {
      const received: unknown[] = [];
      bus.on("signal", (data) => received.push(data));

      bus.emit("signal", { agentName: "agent1", instanceId: "id1", signal: "rerun" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ agentName: "agent1", instanceId: "id1", signal: "rerun" });
    });

    it("delivers webhook:received event to listener", () => {
      const received: unknown[] = [];
      bus.on("webhook:received", (data) => received.push(data));

      bus.emit("webhook:received", { source: "github", event: "push" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ source: "github", event: "push" });
    });

    it("delivers webhook:dispatched event to listener", () => {
      const received: unknown[] = [];
      bus.on("webhook:dispatched", (data) => received.push(data));

      bus.emit("webhook:dispatched", { source: "github", agents: ["agent1", "agent2"] });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ source: "github", agents: ["agent1", "agent2"] });
    });

    it("calls multiple listeners for the same event", () => {
      const results: number[] = [];
      bus.on("run:start", () => results.push(1));
      bus.on("run:start", () => results.push(2));

      bus.emit("run:start", { agentName: "a", instanceId: "i", trigger: "manual" });

      expect(results).toEqual([1, 2]);
    });

    it("returns the bus instance from on() for chaining", () => {
      const result = bus.on("run:start", () => {});
      expect(result).toBe(bus);
    });
  });

  describe("once", () => {
    it("calls listener only once", () => {
      const received: unknown[] = [];
      bus.once("run:start", (data) => received.push(data));

      bus.emit("run:start", { agentName: "a1", instanceId: "i1", trigger: "cron" });
      bus.emit("run:start", { agentName: "a2", instanceId: "i2", trigger: "cron" });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ agentName: "a1" });
    });

    it("returns the bus instance from once() for chaining", () => {
      const result = bus.once("run:start", () => {});
      expect(result).toBe(bus);
    });
  });

  describe("off", () => {
    it("removes a specific listener", () => {
      const received: unknown[] = [];
      const listener = (data: unknown) => received.push(data);
      bus.on("run:start", listener as any);
      bus.off("run:start", listener as any);

      bus.emit("run:start", { agentName: "a", instanceId: "i", trigger: "cron" });

      expect(received).toHaveLength(0);
    });

    it("only removes the specified listener, not others", () => {
      const received1: unknown[] = [];
      const received2: unknown[] = [];
      const listener1 = (data: unknown) => received1.push(data);
      const listener2 = (data: unknown) => received2.push(data);

      bus.on("run:start", listener1 as any);
      bus.on("run:start", listener2 as any);
      bus.off("run:start", listener1 as any);

      bus.emit("run:start", { agentName: "a", instanceId: "i", trigger: "cron" });

      expect(received1).toHaveLength(0);
      expect(received2).toHaveLength(1);
    });

    it("returns the bus instance from off() for chaining", () => {
      const listener = () => {};
      bus.on("run:start", listener);
      const result = bus.off("run:start", listener);
      expect(result).toBe(bus);
    });
  });

  describe("removeAllListeners", () => {
    it("removes all listeners across all events", () => {
      const received: unknown[] = [];
      bus.on("run:start", () => received.push("run:start"));
      bus.on("run:end", () => received.push("run:end"));

      bus.removeAllListeners();

      bus.emit("run:start", { agentName: "a", instanceId: "i", trigger: "cron" });
      bus.emit("run:end", { agentName: "a", instanceId: "i", result: "ok" });

      expect(received).toHaveLength(0);
    });
  });

  describe("waitFor", () => {
    it("resolves when the matching event is emitted", async () => {
      const promise = bus.waitFor("run:start");

      bus.emit("run:start", { agentName: "agent1", instanceId: "id1", trigger: "cron" });

      const result = await promise;
      expect(result).toEqual({ agentName: "agent1", instanceId: "id1", trigger: "cron" });
    });

    it("resolves only when predicate matches", async () => {
      const promise = bus.waitFor("run:start", (data) => data.agentName === "agent2");

      bus.emit("run:start", { agentName: "agent1", instanceId: "id1", trigger: "cron" });
      bus.emit("run:start", { agentName: "agent2", instanceId: "id2", trigger: "cron" });

      const result = await promise;
      expect(result.agentName).toBe("agent2");
    });

    it("rejects on timeout", async () => {
      const promise = bus.waitFor("run:start", undefined, 10);

      await expect(promise).rejects.toThrow('Timed out waiting for "run:start" event after 10ms');
    });

    it("cleans up listener after timeout", async () => {
      const promise = bus.waitFor("run:start", undefined, 10);
      await expect(promise).rejects.toThrow();

      // After timeout, emitting should not cause errors
      expect(() => bus.emit("run:start", { agentName: "a", instanceId: "i", trigger: "cron" })).not.toThrow();
    });

    it("cleans up timeout after event fires", async () => {
      vi.useFakeTimers();
      const promise = bus.waitFor("run:start", undefined, 5000);

      bus.emit("run:start", { agentName: "a", instanceId: "i", trigger: "cron" });
      await promise;

      // Should not throw after advancing time (timer was cleared)
      vi.advanceTimersByTime(10000);
      vi.useRealTimers();
    });
  });

  describe("collect", () => {
    it("collects events emitted after calling collect()", () => {
      const handle = bus.collect("run:start");

      bus.emit("run:start", { agentName: "a1", instanceId: "i1", trigger: "cron" });
      bus.emit("run:start", { agentName: "a2", instanceId: "i2", trigger: "manual" });

      const results = handle.stop();
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ agentName: "a1" });
      expect(results[1]).toMatchObject({ agentName: "a2" });
    });

    it("stops collecting after stop() is called", () => {
      const handle = bus.collect("run:start");

      bus.emit("run:start", { agentName: "a1", instanceId: "i1", trigger: "cron" });
      const results = handle.stop();

      bus.emit("run:start", { agentName: "a2", instanceId: "i2", trigger: "manual" });

      expect(results).toHaveLength(1);
    });

    it("returns empty array when no events emitted before stop", () => {
      const handle = bus.collect("run:start");
      const results = handle.stop();
      expect(results).toEqual([]);
    });

    it("collects lock events with full details", () => {
      const handle = bus.collect("lock");

      bus.emit("lock", { agentName: "a", instanceId: "i", resourceKey: "res://r", action: "acquire", ok: true, status: 200 });
      bus.emit("lock", { agentName: "a", instanceId: "i", resourceKey: "res://r", action: "release", ok: true, status: 200 });

      const results = handle.stop();
      expect(results).toHaveLength(2);
      expect(results[0].action).toBe("acquire");
      expect(results[1].action).toBe("release");
    });

    it("does not collect events that were emitted before calling collect()", () => {
      bus.emit("run:start", { agentName: "before", instanceId: "i0", trigger: "cron" });

      const handle = bus.collect("run:start");
      bus.emit("run:start", { agentName: "after", instanceId: "i1", trigger: "cron" });

      const results = handle.stop();
      expect(results).toHaveLength(1);
      expect(results[0].agentName).toBe("after");
    });
  });
});
