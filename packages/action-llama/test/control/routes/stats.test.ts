import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerStatsRoutes } from "../../../src/control/routes/stats.js";

function mockStatsStore() {
  return {
    queryRunsByAgentPaginated: vi.fn().mockReturnValue([]),
    countRunsByAgent: vi.fn().mockReturnValue(0),
    queryRunByInstanceId: vi.fn().mockReturnValue(undefined),
    getWebhookReceipt: vi.fn().mockReturnValue(undefined),
    queryTriggerHistory: vi.fn().mockReturnValue([]),
    countTriggerHistory: vi.fn().mockReturnValue(0),
  } as any;
}

function mockStatusTracker(instances: any[] = []) {
  return {
    getInstances: vi.fn().mockReturnValue(instances),
    isPaused: vi.fn().mockReturnValue(false),
  } as any;
}

function createApp(statsStore?: any, statusTracker?: any) {
  const app = new Hono();
  registerStatsRoutes(app, statsStore, statusTracker);
  return app;
}

describe("stats routes", () => {
  it("returns paginated runs for an agent", async () => {
    const stats = mockStatsStore();
    stats.queryRunsByAgentPaginated.mockReturnValue([{ instance_id: "abc" }]);
    stats.countRunsByAgent.mockReturnValue(1);
    const app = createApp(stats);

    const res = await app.request("/api/stats/agents/reporter/runs?page=1&limit=10");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(10);
    expect(stats.queryRunsByAgentPaginated).toHaveBeenCalledWith("reporter", 10, 0);
  });

  it("respects page and limit params", async () => {
    const stats = mockStatsStore();
    const app = createApp(stats);

    await app.request("/api/stats/agents/reporter/runs?page=3&limit=5");
    expect(stats.queryRunsByAgentPaginated).toHaveBeenCalledWith("reporter", 5, 10);
  });

  it("clamps limit to 100", async () => {
    const stats = mockStatsStore();
    const app = createApp(stats);

    await app.request("/api/stats/agents/reporter/runs?page=1&limit=999");
    expect(stats.queryRunsByAgentPaginated).toHaveBeenCalledWith("reporter", 100, 0);
  });

  it("defaults page to 1 and limit to 10", async () => {
    const stats = mockStatsStore();
    const app = createApp(stats);

    await app.request("/api/stats/agents/reporter/runs");
    expect(stats.queryRunsByAgentPaginated).toHaveBeenCalledWith("reporter", 10, 0);
  });

  it("returns single run by instance ID", async () => {
    const stats = mockStatsStore();
    stats.queryRunByInstanceId.mockReturnValue({ instance_id: "abc", result: "completed" });
    const app = createApp(stats);

    const res = await app.request("/api/stats/agents/reporter/runs/abc");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.run.instance_id).toBe("abc");
    expect(stats.queryRunByInstanceId).toHaveBeenCalledWith("abc");
  });

  it("returns null for missing instance", async () => {
    const stats = mockStatsStore();
    const app = createApp(stats);

    const res = await app.request("/api/stats/agents/reporter/runs/missing");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.run).toBeNull();
  });

  it("returns empty data when no stats store", async () => {
    const app = createApp();

    const res = await app.request("/api/stats/agents/reporter/runs?page=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(0);
    expect(data.total).toBe(0);

    const res2 = await app.request("/api/stats/agents/reporter/runs/abc");
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.run).toBeNull();
  });

  it("returns webhook receipt by ID", async () => {
    const stats = mockStatsStore();
    const mockReceipt = {
      id: "test-receipt-id",
      source: "github",
      eventSummary: "push to main",
      timestamp: 1000000,
      matchedAgents: 2,
      status: "processed",
    };
    stats.getWebhookReceipt.mockReturnValue(mockReceipt);
    const app = createApp(stats);

    const res = await app.request("/api/stats/webhooks/test-receipt-id");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.receipt).toMatchObject(mockReceipt);
    expect(stats.getWebhookReceipt).toHaveBeenCalledWith("test-receipt-id");
  });

  it("returns 404 for missing receipt", async () => {
    const stats = mockStatsStore();
    stats.getWebhookReceipt.mockReturnValue(undefined);
    const app = createApp(stats);

    const res = await app.request("/api/stats/webhooks/missing-id");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.receipt).toBeNull();
  });

  it("returns null receipt when no stats store", async () => {
    const app = createApp();

    const res = await app.request("/api/stats/webhooks/any-id");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.receipt).toBeNull();
  });

  describe("GET /api/stats/triggers", () => {
    it("returns empty triggers when no stats store is provided", async () => {
      const app = createApp();

      const res = await app.request("/api/stats/triggers");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.triggers).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.limit).toBe(50);
      expect(data.offset).toBe(0);
    });

    it("returns triggers from the stats store", async () => {
      const stats = mockStatsStore();
      const trigger = { ts: 1000, triggerType: "schedule", agentName: "reporter", instanceId: "i1", result: "completed" };
      stats.queryTriggerHistory.mockReturnValue([trigger]);
      stats.countTriggerHistory.mockReturnValue(1);
      const app = createApp(stats);

      const res = await app.request("/api/stats/triggers");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.triggers).toHaveLength(1);
      expect(data.triggers[0]).toMatchObject(trigger);
      expect(data.total).toBe(1);
    });

    it("passes correct params to queryTriggerHistory", async () => {
      const stats = mockStatsStore();
      const app = createApp(stats);

      await app.request("/api/stats/triggers?limit=20&offset=40&since=9999&all=1&agent=reporter");
      expect(stats.queryTriggerHistory).toHaveBeenCalledWith({
        since: 9999,
        limit: 20,
        offset: 40,
        includeDeadLetters: true,
        agentName: "reporter",
      });
      expect(stats.countTriggerHistory).toHaveBeenCalledWith(9999, true, "reporter");
    });

    it("defaults limit to 50 and offset to 0", async () => {
      const stats = mockStatsStore();
      const app = createApp(stats);

      await app.request("/api/stats/triggers");
      expect(stats.queryTriggerHistory).toHaveBeenCalledWith({
        since: 0,
        limit: 50,
        offset: 0,
        includeDeadLetters: false,
        agentName: undefined,
      });
    });

    it("clamps limit to 100", async () => {
      const stats = mockStatsStore();
      const app = createApp(stats);

      await app.request("/api/stats/triggers?limit=999");
      expect(stats.queryTriggerHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });

    it("merges running instances from statusTracker into first page results", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([
        { ts: 500, triggerType: "schedule", agentName: "reporter", instanceId: "i1", result: "completed" },
      ]);
      stats.countTriggerHistory.mockReturnValue(1);

      const runningInst = {
        id: "inst-running",
        agentName: "reporter",
        status: "running",
        startedAt: new Date(2000).toISOString(),
        trigger: "manual:user",
      };
      const tracker = mockStatusTracker([runningInst]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/triggers");
      expect(res.status).toBe(200);
      const data = await res.json();

      // Should have running + completed = 2 entries
      expect(data.triggers).toHaveLength(2);
      expect(data.total).toBe(2);

      const running = data.triggers.find((t: any) => t.result === "running");
      expect(running).toBeDefined();
      expect(running.instanceId).toBe("inst-running");
      expect(running.triggerType).toBe("manual");
      expect(running.triggerSource).toBe("user");
    });

    it("does not merge running instances when offset > 0", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const tracker = mockStatusTracker([
        { id: "running-1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
      ]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/triggers?offset=10");
      const data = await res.json();

      // Running instances should NOT be merged when offset > 0
      expect(data.triggers).toHaveLength(0);
      expect(data.total).toBe(0);
    });

    it("filters running instances by agent when agent param is provided", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const instances = [
        { id: "inst-1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
        { id: "inst-2", agentName: "other-agent", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
      ];
      const tracker = mockStatusTracker(instances);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/triggers?agent=reporter");
      const data = await res.json();

      expect(data.triggers).toHaveLength(1);
      expect(data.triggers[0].instanceId).toBe("inst-1");
    });

    it("handles trigger without colon separator (no triggerSource)", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const tracker = mockStatusTracker([
        { id: "inst-1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
      ]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/triggers");
      const data = await res.json();

      expect(data.triggers[0].triggerType).toBe("schedule");
      expect(data.triggers[0].triggerSource).toBeNull();
    });
  });
});
