import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerStatsRoutes } from "../../../src/control/routes/stats.js";

function mockStatsStore() {
  return {
    queryRunsByAgentPaginated: vi.fn().mockReturnValue([]),
    countRunsByAgent: vi.fn().mockReturnValue(0),
    queryRunByInstanceId: vi.fn().mockReturnValue(undefined),
    getWebhookReceipt: vi.fn().mockReturnValue(undefined),
    getWebhookSourcesBatch: vi.fn().mockReturnValue({}),
    getWebhookDetailsBatch: vi.fn().mockReturnValue({}),
    queryTriggerHistory: vi.fn().mockReturnValue([]),
    countTriggerHistory: vi.fn().mockReturnValue(0),
    queryActivityRows: vi.fn().mockReturnValue([]),
    countActivityRows: vi.fn().mockReturnValue(0),
  } as any;
}

function mockStatusTracker(instances: any[] = [], agents: any[] = []) {
  return {
    getInstances: vi.fn().mockReturnValue(instances),
    getAllAgents: vi.fn().mockReturnValue(agents),
    isPaused: vi.fn().mockReturnValue(false),
  } as any;
}

function createApp(statsStore?: any, statusTracker?: any, controlDeps?: any) {
  const app = new Hono();
  registerStatsRoutes(app, statsStore, statusTracker, controlDeps);
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
      expect(stats.countTriggerHistory).toHaveBeenCalledWith(9999, true, "reporter", undefined);
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

    it("filters running instances by triggerType when triggerType param is provided", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const instances = [
        { id: "inst-1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule:nightly" },
        { id: "inst-2", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "webhook:github" },
      ];
      const tracker = mockStatusTracker(instances);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/triggers?triggerType=schedule");
      const data = await res.json();

      expect(data.triggers).toHaveLength(1);
      expect(data.triggers[0].instanceId).toBe("inst-1");
      expect(data.triggers[0].triggerType).toBe("schedule");
    });

    it("passes triggerType filter to queryTriggerHistory and countTriggerHistory", async () => {
      const stats = mockStatsStore();
      const app = createApp(stats);

      await app.request("/api/stats/triggers?triggerType=webhook");
      expect(stats.queryTriggerHistory).toHaveBeenCalledWith(
        expect.objectContaining({ triggerType: "webhook" })
      );
      expect(stats.countTriggerHistory).toHaveBeenCalledWith(0, false, undefined, "webhook");
    });
  });

  describe("GET /api/stats/jobs", () => {
    it("returns empty jobs when no stats store is provided", async () => {
      const app = createApp();

      const res = await app.request("/api/stats/jobs");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.jobs).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.limit).toBe(50);
      expect(data.offset).toBe(0);
      expect(data.pending).toEqual({});
      expect(data.totalPending).toBe(0);
    });

    it("returns jobs from the stats store", async () => {
      const stats = mockStatsStore();
      const job = { ts: 1000, triggerType: "schedule", agentName: "reporter", instanceId: "j1", result: "completed" };
      stats.queryTriggerHistory.mockReturnValue([job]);
      stats.countTriggerHistory.mockReturnValue(1);
      const app = createApp(stats);

      const res = await app.request("/api/stats/jobs");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.jobs).toHaveLength(1);
      expect(data.jobs[0]).toMatchObject(job);
      expect(data.total).toBe(1);
    });

    it("passes correct params to queryTriggerHistory (always excludes dead letters)", async () => {
      const stats = mockStatsStore();
      const app = createApp(stats);

      await app.request("/api/stats/jobs?limit=20&offset=40&since=9999&agent=reporter");
      expect(stats.queryTriggerHistory).toHaveBeenCalledWith({
        since: 9999,
        limit: 20,
        offset: 40,
        includeDeadLetters: false,
        agentName: "reporter",
      });
      expect(stats.countTriggerHistory).toHaveBeenCalledWith(9999, false, "reporter");
    });

    it("merges unique running instances from statusTracker on first page", async () => {
      const stats = mockStatsStore();
      const existingJob = { ts: 500, triggerType: "schedule", agentName: "reporter", instanceId: "existing-id", result: "completed" };
      stats.queryTriggerHistory.mockReturnValue([existingJob]);
      stats.countTriggerHistory.mockReturnValue(1);

      const instances = [
        { id: "existing-id", agentName: "reporter", status: "running", startedAt: new Date(2000).toISOString(), trigger: "schedule" },
        { id: "new-running-id", agentName: "reporter", status: "running", startedAt: new Date(3000).toISOString(), trigger: "manual:user" },
      ];
      const tracker = mockStatusTracker(instances);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/jobs");
      const data = await res.json();

      // existing-id is in runs already, so only new-running-id is added
      expect(data.jobs).toHaveLength(2);
      expect(data.total).toBe(2);
      const runningJob = data.jobs.find((j: any) => j.instanceId === "new-running-id");
      expect(runningJob).toBeDefined();
      expect(runningJob.result).toBe("running");
      expect(runningJob.triggerType).toBe("manual");
      expect(runningJob.triggerSource).toBe("user");
    });

    it("does not merge running instances when offset > 0", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const tracker = mockStatusTracker([
        { id: "r1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
      ]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/jobs?offset=10");
      const data = await res.json();
      expect(data.jobs).toHaveLength(0);
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

      const res = await app.request("/api/stats/jobs?agent=reporter");
      const data = await res.json();

      expect(data.jobs).toHaveLength(1);
      expect(data.jobs[0].instanceId).toBe("inst-1");
    });

    it("reports pending counts from statusTracker agents", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const agents = [
        { name: "reporter", queuedWebhooks: 3 },
        { name: "other", queuedWebhooks: 0 },
        { name: "deployer", queuedWebhooks: 5 },
      ];
      const tracker = mockStatusTracker([], agents);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/jobs");
      const data = await res.json();

      expect(data.pending).toEqual({ reporter: 3, deployer: 5 });
      expect(data.totalPending).toBe(8);
    });

    it("filters pending counts by agent when agent param is provided", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const agents = [
        { name: "reporter", queuedWebhooks: 3 },
        { name: "other", queuedWebhooks: 7 },
      ];
      const tracker = mockStatusTracker([], agents);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/jobs?agent=reporter");
      const data = await res.json();

      expect(data.pending).toEqual({ reporter: 3 });
      expect(data.totalPending).toBe(3);
    });

    it("returns empty pending when no statusTracker is provided", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);
      const app = createApp(stats);

      const res = await app.request("/api/stats/jobs");
      const data = await res.json();

      expect(data.pending).toEqual({});
      expect(data.totalPending).toBe(0);
    });

    it("clamps limit to 100 and offset to 0 minimum", async () => {
      const stats = mockStatsStore();
      const app = createApp(stats);

      await app.request("/api/stats/jobs?limit=999&offset=-5");
      expect(stats.queryTriggerHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 })
      );
    });
  });

  describe("GET /api/stats/activity", () => {
    it("returns empty rows when no stats store is provided", async () => {
      const app = createApp();

      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.rows).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.limit).toBe(50);
      expect(data.offset).toBe(0);
    });

    it("returns rows from the stats store including dead letters", async () => {
      const stats = mockStatsStore();
      const completedRow = { ts: 1000, triggerType: "schedule", agentName: "reporter", instanceId: "i1", result: "completed", webhookReceiptId: null, deadLetterReason: null };
      const deadLetterRow = { ts: 500, triggerType: "webhook", agentName: null, instanceId: null, result: "dead-letter", webhookReceiptId: "r1", deadLetterReason: "no_match" };
      stats.queryActivityRows.mockReturnValue([completedRow, deadLetterRow]);
      stats.countActivityRows.mockReturnValue(2);
      const app = createApp(stats);

      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.rows).toHaveLength(2);
      expect(data.total).toBe(2);
      // Should always pass includeDeadLetters: true (no status filter)
      expect(stats.queryActivityRows).toHaveBeenCalledWith(
        expect.objectContaining({ includeDeadLetters: true })
      );
    });

    it("merges running instances from statusTracker", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([
        { ts: 500, triggerType: "schedule", agentName: "reporter", instanceId: "i1", result: "completed" },
      ]);
      stats.countActivityRows.mockReturnValue(1);

      const tracker = mockStatusTracker([
        { id: "inst-running", agentName: "reporter", status: "running", startedAt: new Date(2000).toISOString(), trigger: "webhook:github" },
      ]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      expect(data.rows).toHaveLength(2);
      const running = data.rows.find((r: any) => r.result === "running");
      expect(running).toBeDefined();
      expect(running.instanceId).toBe("inst-running");
      expect(running.triggerType).toBe("webhook");
      expect(running.triggerSource).toBe("github");
    });

    it("merges pending queue items from controlDeps.workQueue.peek", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([]);

      const tracker = mockStatusTracker([], [
        { name: "reporter", queuedWebhooks: 1 },
      ]);

      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "webhook", context: { source: "github", event: "issues" } }, receivedAt: new Date(3000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);

      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      const pending = data.rows.find((r: any) => r.result === "pending");
      expect(pending).toBeDefined();
      expect(pending.triggerType).toBe("webhook");
      expect(pending.triggerSource).toBe("github");
      expect(pending.instanceId).toBeNull();
      expect(pending.agentName).toBe("reporter");
    });

    it("builds eventSummary from webhook context event and action when both are present", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([]);

      const tracker = mockStatusTracker([], [{ name: "reporter", queuedWebhooks: 1 }]);
      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            {
              context: {
                type: "webhook",
                context: { source: "github", event: "issues", action: "opened" },
              },
              receivedAt: new Date(4000),
            },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      const pending = data.rows.find((r: any) => r.result === "pending");
      expect(pending).toBeDefined();
      expect(pending.triggerType).toBe("webhook");
      expect(pending.triggerSource).toBe("github");
      expect(pending.eventSummary).toBe("issues opened");
    });

    it("filters by status=pending returns only pending rows", async () => {
      const stats = mockStatsStore();
      // queryActivityRows should NOT be called when status=pending (no DB statuses requested)

      const tracker = mockStatusTracker([], [{ name: "reporter", queuedWebhooks: 1 }]);
      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "schedule" }, receivedAt: new Date(3000) },
          ]),
        },
      };
      const app = createApp(stats, tracker, controlDeps);

      const res = await app.request("/api/stats/activity?status=pending");
      const data = await res.json();

      expect(data.rows.every((r: any) => r.result === "pending")).toBe(true);
      // DB should NOT be queried for pending-only filter
      expect(stats.queryActivityRows).not.toHaveBeenCalled();
    });

    it("filters by status=dead-letter returns only dead letters", async () => {
      const stats = mockStatsStore();
      // With status=dead-letter, queryActivityRows is called with dbStatuses=['dead-letter']
      stats.queryActivityRows.mockReturnValue([
        { ts: 500, triggerType: "webhook", agentName: null, instanceId: null, result: "dead-letter", webhookReceiptId: "r1", deadLetterReason: "no_match" },
      ]);
      stats.countActivityRows.mockReturnValue(1);

      const app = createApp(stats);

      const res = await app.request("/api/stats/activity?status=dead-letter");
      const data = await res.json();

      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].result).toBe("dead-letter");
      expect(stats.queryActivityRows).toHaveBeenCalledWith(
        expect.objectContaining({ dbStatuses: ["dead-letter"], includeDeadLetters: true })
      );
    });

    it("filters by agent parameter", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([
        { ts: 1000, triggerType: "schedule", agentName: "reporter", instanceId: "i1", result: "completed" },
      ]);
      stats.countActivityRows.mockReturnValue(1);

      const app = createApp(stats);

      await app.request("/api/stats/activity?agent=reporter");
      expect(stats.queryActivityRows).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: "reporter" })
      );
    });

    it("sorts rows by status group (pending → running → rest) then ts descending", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([
        { ts: 1000, triggerType: "schedule", agentName: "reporter", instanceId: "i1", result: "completed" },
        { ts: 300, triggerType: "webhook", agentName: "reporter", instanceId: "i2", result: "error" },
      ]);
      stats.countActivityRows.mockReturnValue(2);

      const tracker = mockStatusTracker([
        { id: "r1", agentName: "reporter", status: "running", startedAt: new Date(2000).toISOString(), trigger: "manual" },
      ]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      // Rows should be sorted by group then ts: running (ts=2000), completed (ts=1000), error (ts=300)
      expect(data.rows[0].result).toBe("running");
      expect(data.rows[0].ts).toBe(2000);
      expect(data.rows[1].result).toBe("completed");
      expect(data.rows[1].ts).toBe(1000);
      expect(data.rows[2].result).toBe("error");
      expect(data.rows[2].ts).toBe(300);
    });

    it("sorts pending rows before running, and running before completed/error", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([
        { ts: 5000, triggerType: "schedule", agentName: "reporter", instanceId: "i-completed", result: "completed" },
        { ts: 1000, triggerType: "webhook", agentName: "reporter", instanceId: "i-error", result: "error" },
      ]);
      stats.countActivityRows.mockReturnValue(2);

      const tracker = mockStatusTracker([
        { id: "i-running", agentName: "reporter", status: "running", startedAt: new Date(3000).toISOString(), trigger: "manual" },
      ], [
        { name: "reporter" },
      ]);

      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "webhook", source: "github" }, receivedAt: new Date(2000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      // Expected order: pending (ts=2000), running (ts=3000), completed (ts=5000), error (ts=1000)
      // pending and running come before completed/error regardless of their ts values
      expect(data.rows.map((r: any) => r.result)).toEqual(["pending", "running", "completed", "error"]);
    });

    it("paginates results with limit and offset", async () => {
      const stats = mockStatsStore();
      // With offset=1, limit=2, no mem rows: DB is queried with offset=1, limit=2
      stats.queryActivityRows.mockReturnValue([
        { ts: 2000, result: "completed", triggerType: "schedule", agentName: "a", instanceId: "i2" },
        { ts: 1000, result: "completed", triggerType: "schedule", agentName: "a", instanceId: "i3" },
      ]);
      stats.countActivityRows.mockReturnValue(3);

      const app = createApp(stats);

      const res = await app.request("/api/stats/activity?limit=2&offset=1");
      const data = await res.json();

      expect(data.total).toBe(3);
      expect(data.rows).toHaveLength(2);
      expect(data.rows[0].instanceId).toBe("i2");
      // Verify DB was called with correct SQL-level pagination
      expect(stats.queryActivityRows).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 2, offset: 1 })
      );
    });

    it("filters out non-running instances from statusTracker in activity endpoint", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([]);

      // Provide one running and one non-running instance
      const tracker = mockStatusTracker([
        { id: "r1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
        { id: "r2", agentName: "reporter", status: "completed", startedAt: new Date().toISOString(), trigger: "schedule" },
      ], []);

      const app = createApp(stats, tracker);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      // Only the running instance should be merged in
      const runningRows = data.rows.filter((r: any) => r.result === "running");
      expect(runningRows).toHaveLength(1);
      expect(runningRows[0].instanceId).toBe("r1");
    });

    it("filters workQueue items by agent when agent param is provided", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([]);

      const tracker = mockStatusTracker([], [
        { name: "reporter" },
        { name: "other-agent" },
      ]);

      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "schedule" }, receivedAt: new Date(3000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity?agent=reporter");
      const data = await res.json();

      // workQueue.peek should only be called for the reporter agent
      expect(controlDeps.workQueue.peek).toHaveBeenCalledWith("reporter");
      expect(controlDeps.workQueue.peek).not.toHaveBeenCalledWith("other-agent");

      const pending = data.rows.find((r: any) => r.result === "pending");
      expect(pending).toBeDefined();
      expect(pending.agentName).toBe("reporter");
    });

    it("classifies queue items with ctx.type=agent-trigger as agent triggerType", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);

      const tracker = mockStatusTracker([], [{ name: "reporter" }]);

      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "agent-trigger", sourceAgent: "planner" }, receivedAt: new Date(3000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      const pending = data.rows.find((r: any) => r.result === "pending");
      expect(pending).toBeDefined();
      expect(pending.triggerType).toBe("agent");
      expect(pending.triggerSource).toBe("planner");
    });

    it("classifies queue items with ctx.type=agent as agent triggerType", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);

      const tracker = mockStatusTracker([], [{ name: "reporter" }]);

      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "agent", sourceAgent: "orchestrator" }, receivedAt: new Date(3000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      const pending = data.rows.find((r: any) => r.result === "pending");
      expect(pending).toBeDefined();
      expect(pending.triggerType).toBe("agent");
      expect(pending.triggerSource).toBe("orchestrator");
    });

    it("classifies queue items with ctx.type=manual as manual triggerType", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);

      const tracker = mockStatusTracker([], [{ name: "reporter" }]);

      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "manual" }, receivedAt: new Date(3000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      const pending = data.rows.find((r: any) => r.result === "pending");
      expect(pending).toBeDefined();
      expect(pending.triggerType).toBe("manual");
      expect(pending.triggerSource).toBeNull();
    });

    it("classifies queue items with unknown ctx.type using the raw type string", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);

      const tracker = mockStatusTracker([], [{ name: "reporter" }]);

      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(1),
          peek: vi.fn().mockReturnValue([
            { context: { type: "custom-trigger-type" }, receivedAt: new Date(3000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      const pending = data.rows.find((r: any) => r.result === "pending");
      expect(pending).toBeDefined();
      expect(pending.triggerType).toBe("custom-trigger-type");
    });
  });

  describe("GET /api/stats/triggers - non-running instance filter", () => {
    it("filters out non-running instances from statusTracker in triggers endpoint", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const tracker = mockStatusTracker([
        { id: "r1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
        { id: "r2", agentName: "reporter", status: "failed", startedAt: new Date().toISOString(), trigger: "schedule" },
      ]);

      const app = createApp(stats, tracker);
      const res = await app.request("/api/stats/triggers");
      const data = await res.json();

      // Only the running instance should be merged in
      const runningItems = data.triggers.filter((t: any) => t.result === "running");
      expect(runningItems).toHaveLength(1);
      expect(runningItems[0].instanceId).toBe("r1");
    });
  });

  describe("GET /api/stats/jobs - non-running instance filter", () => {
    it("filters out non-running instances from statusTracker in jobs endpoint", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const tracker = mockStatusTracker([
        { id: "j1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
        { id: "j2", agentName: "reporter", status: "completed", startedAt: new Date().toISOString(), trigger: "schedule" },
      ], [{ name: "reporter" }]);

      const app = createApp(stats, tracker);
      const res = await app.request("/api/stats/jobs");
      const data = await res.json();

      // Only the running instance should be merged in
      const runningJobs = data.jobs.filter((j: any) => j.result === "running");
      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0].instanceId).toBe("j1");
    });

    it("includes all running instances regardless of trigger type in jobs endpoint", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);
      stats.countTriggerHistory.mockReturnValue(0);

      const tracker = mockStatusTracker([
        { id: "j1", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule:nightly" },
        { id: "j2", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "webhook:github" },
      ], [{ name: "reporter" }]);

      const app = createApp(stats, tracker);
      const res = await app.request("/api/stats/jobs");
      const data = await res.json();

      // Both running instances should be included since jobs doesn't filter by triggerType
      const runningJobs = data.jobs.filter((j: any) => j.result === "running");
      expect(runningJobs).toHaveLength(2);
    });
  });

  describe("GET /api/stats/activity — filter coverage for uncovered paths", () => {
    it("filters running instances by agentName in activity endpoint (L171)", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([]);

      // Two instances with different agentNames; filter for "reporter" should exclude "other"
      const tracker = mockStatusTracker([
        { id: "inst-reporter", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
        { id: "inst-other", agentName: "other-agent", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
      ], [{ name: "reporter" }, { name: "other-agent" }]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/activity?agent=reporter");
      const data = await res.json();

      // Only "reporter" running instance should appear
      const runningRows = data.rows.filter((r: any) => r.result === "running");
      expect(runningRows.every((r: any) => r.agentName === "reporter")).toBe(true);
    });

    it("filters running instances by triggerType in activity endpoint (L172-175)", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([]);

      // Two instances with different trigger types
      const tracker = mockStatusTracker([
        { id: "inst-sched", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" },
        { id: "inst-wh", agentName: "reporter", status: "running", startedAt: new Date().toISOString(), trigger: "webhook:github" },
      ], [{ name: "reporter" }]);
      const app = createApp(stats, tracker);

      const res = await app.request("/api/stats/activity?triggerType=schedule");
      const data = await res.json();

      // Only "schedule" trigger instance should appear in running rows
      const runningRows = data.rows.filter((r: any) => r.result === "running");
      expect(runningRows.every((r: any) => r.triggerType === "schedule")).toBe(true);
    });

    it("enriches webhook rows with triggerSource and eventSummary from receipt details", async () => {
      const stats = mockStatsStore();
      // Return a webhook row with triggerSource and eventSummary populated from SQL JOIN
      stats.queryActivityRows.mockReturnValue([
        {
          ts: 1000,
          triggerType: "webhook",
          triggerSource: "github",
          eventSummary: "issues opened",
          agentName: "reporter",
          instanceId: "i-wh",
          result: "completed",
          webhookReceiptId: "receipt-1",
          deadLetterReason: null,
        },
      ]);
      stats.countActivityRows.mockReturnValue(1);
      const app = createApp(stats);

      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);
      const data = await res.json();

      const webhookRow = data.rows.find((r: any) => r.instanceId === "i-wh");
      expect(webhookRow).toBeDefined();
      // triggerSource should be set from SQL JOIN
      expect(webhookRow.triggerSource).toBe("github");
      // eventSummary should be set because it differs from source
      expect(webhookRow.eventSummary).toBe("issues opened");
    });

    it("sets triggerSource but not eventSummary when eventSummary equals source", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([
        {
          ts: 1000,
          triggerType: "webhook",
          triggerSource: "github",
          eventSummary: undefined,
          agentName: "reporter",
          instanceId: "i-wh2",
          result: "completed",
          webhookReceiptId: "receipt-2",
          deadLetterReason: null,
        },
      ]);
      stats.countActivityRows.mockReturnValue(1);
      const app = createApp(stats);

      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);
      const data = await res.json();

      const webhookRow = data.rows.find((r: any) => r.instanceId === "i-wh2");
      expect(webhookRow).toBeDefined();
      expect(webhookRow.triggerSource).toBe("github");
      // eventSummary should NOT be set since it equals source
      expect(webhookRow.eventSummary).toBeUndefined();
    });

    it("filters pending queue items by triggerType in activity endpoint (L222)", async () => {
      const stats = mockStatsStore();
      stats.queryTriggerHistory.mockReturnValue([]);

      // One tracker agent with a work queue containing both webhook and schedule items
      const tracker = mockStatusTracker([], [{ name: "reporter" }]);
      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(2),
          peek: vi.fn().mockReturnValue([
            { context: { type: "webhook", context: { source: "github", event: "issues" } }, receivedAt: new Date(1000) },
            { context: { type: "schedule" }, receivedAt: new Date(2000) },
          ]),
        },
      };
      const app = createApp(stats, tracker, controlDeps);

      const res = await app.request("/api/stats/activity?triggerType=schedule");
      const data = await res.json();

      // The webhook queue item should be filtered out by L222
      const pendingRows = data.rows.filter((r: any) => r.result === "pending");
      expect(pendingRows.every((r: any) => r.triggerType === "schedule")).toBe(true);
      expect(pendingRows.some((r: any) => r.triggerType === "webhook")).toBe(false);
    });
  });

  describe("GET /api/stats/activity — pendingCount field", () => {
    it("returns pendingCount=0 when there are no pending items", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([
        { ts: 1000, triggerType: "schedule", agentName: "reporter", instanceId: "i1", result: "completed" },
      ]);
      stats.countActivityRows.mockReturnValue(1);

      const app = createApp(stats);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      expect(data.pendingCount).toBe(0);
    });

    it("returns pendingCount matching actual pending queue items so badge and table stay consistent", async () => {
      const stats = mockStatsStore();
      stats.queryActivityRows.mockReturnValue([]);
      stats.countActivityRows.mockReturnValue(0);

      const tracker = mockStatusTracker([], [{ name: "reporter", queuedWebhooks: 2 }]);
      const controlDeps = {
        workQueue: {
          size: vi.fn().mockReturnValue(2),
          peek: vi.fn().mockReturnValue([
            { context: { type: "webhook", context: { source: "github" } }, receivedAt: new Date(3000) },
            { context: { type: "schedule" }, receivedAt: new Date(2000) },
          ]),
        },
      };

      const app = createApp(stats, tracker, controlDeps);
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      expect(data.pendingCount).toBe(2);
      // Verify badge source matches table rows
      const pendingRows = data.rows.filter((r: any) => r.result === "pending");
      expect(pendingRows).toHaveLength(data.pendingCount);
    });

    it("returns pendingCount=0 when no stats store is provided", async () => {
      const app = createApp();
      const res = await app.request("/api/stats/activity");
      const data = await res.json();

      expect(data.pendingCount).toBe(0);
    });
  });
});
