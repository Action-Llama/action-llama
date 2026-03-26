import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerStatsRoutes } from "../../../src/control/routes/stats.js";

function mockStatsStore() {
  return {
    queryRunsByAgentPaginated: vi.fn().mockReturnValue([]),
    countRunsByAgent: vi.fn().mockReturnValue(0),
    queryRunByInstanceId: vi.fn().mockReturnValue(undefined),
    getWebhookReceipt: vi.fn().mockReturnValue(undefined),
  } as any;
}

function createApp(statsStore?: any) {
  const app = new Hono();
  registerStatsRoutes(app, statsStore);
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
});
