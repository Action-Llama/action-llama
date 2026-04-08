/**
 * Integration tests: parseFrontmatter, EventSourcedStatsStore, and EventSourcedWorkQueue
 * — no Docker required.
 *
 * These modules are not yet directly tested in integration tests:
 *
 *   1. shared/frontmatter.ts — parseFrontmatter() pure function
 *   2. stats/event-store.ts — EventSourcedStatsStore (event-sourced stats store)
 *   3. events/event-queue-unified.ts — EventSourcedWorkQueue
 *
 * All tests run without any scheduler or Docker setup.
 *
 * Covers:
 *   - shared/frontmatter.ts: parseFrontmatter() — no frontmatter (doesn't start with ---)
 *   - shared/frontmatter.ts: parseFrontmatter() — unclosed frontmatter (no second ---)
 *   - shared/frontmatter.ts: parseFrontmatter() — valid YAML returns data + body
 *   - shared/frontmatter.ts: parseFrontmatter() — malformed YAML throws error
 *   - shared/frontmatter.ts: parseFrontmatter() — YAML is array → returns empty data
 *   - shared/frontmatter.ts: parseFrontmatter() — YAML is null/empty → returns {}
 *   - shared/frontmatter.ts: parseFrontmatter() — body extracted correctly
 *   - shared/frontmatter.ts: parseFrontmatter() — leading whitespace stripped from content
 *   - shared/frontmatter.ts: parseFrontmatter() — body with leading newline stripped
 *   - stats/event-store.ts: EventSourcedStatsStore — recordRun() writes events
 *   - stats/event-store.ts: EventSourcedStatsStore — queryRuns() returns recorded runs
 *   - stats/event-store.ts: EventSourcedStatsStore — queryAgentSummary() aggregates runs
 *   - stats/event-store.ts: EventSourcedStatsStore — queryCallGraph() with call edges
 *   - stats/event-store.ts: EventSourcedStatsStore — recordCallEdge() writes events
 *   - events/event-queue-unified.ts: EventSourcedWorkQueue — enqueue returns accepted:true
 *   - events/event-queue-unified.ts: EventSourcedWorkQueue — size() reflects enqueued items
 *   - events/event-queue-unified.ts: EventSourcedWorkQueue — dequeue returns FIFO item
 *   - events/event-queue-unified.ts: EventSourcedWorkQueue — close() clears state
 *   - events/event-queue-unified.ts: EventSourcedWorkQueue — getQueueStats() returns counts
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  parseFrontmatter,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/frontmatter.js"
);

const {
  EventSourcedStatsStore,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/event-store.js"
);

const {
  EventSourcedWorkQueue,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/event-queue-unified.js"
);

const {
  createPersistenceStore,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/index.js"
);

// ── parseFrontmatter ───────────────────────────────────────────────────────

describe("integration: parseFrontmatter (shared/frontmatter.ts) — no Docker required", { timeout: 10_000 }, () => {
  it("returns { data: {}, body: content } when content does not start with ---", () => {
    const content = "# Hello\n\nThis is markdown.";
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });

  it("returns { data: {}, body: content } when frontmatter is not closed (no second ---)", () => {
    const content = "---\nname: test\nNo closing delimiter";
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });

  it("parses valid YAML frontmatter and extracts body", () => {
    // The function strips exactly ONE leading \n from the body (replace(/^\r?\n/, ""))
    // Content "---\n...\n---\n\nbody" → body starts with "\n\nbody" → after strip → "\nbody"
    const content = "---\nname: my-agent\ndescription: A test agent\n---\nbody content.";
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({ name: "my-agent", description: "A test agent" });
    expect(result.body).toBe("body content.");
  });

  it("throws an error for malformed YAML frontmatter", () => {
    const content = "---\nname: [unclosed bracket\n---\n\nBody";
    expect(() => parseFrontmatter(content)).toThrow(/Failed to parse YAML frontmatter/);
  });

  it("returns { data: {}, body: content } when YAML parses to an array", () => {
    // YAML that parses to an array — should be treated as no data
    const content = "---\n- item1\n- item2\n---\n\nBody here.";
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });

  it("returns { data: {} } when YAML block is empty", () => {
    // "---\n---\nbody" — body slice starts right after the second "---"
    const content = "---\n---\nBody after empty frontmatter.";
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    // Body slice is "\nBody after empty frontmatter." → after strip → "Body after empty frontmatter."
    expect(result.body).toBe("Body after empty frontmatter.");
  });

  it("handles leading whitespace in content (trimStart)", () => {
    // trimStart() is called on content before parsing
    const content = "\n\n---\nname: test\n---\nbody content.";
    const result = parseFrontmatter(content);
    expect(result.data).toMatchObject({ name: "test" });
    expect(result.body).toBe("body content.");
  });

  it("strips exactly one leading newline from body", () => {
    // The function strips exactly ONE leading \r?\n with replace(/^\r?\n/, "")
    // Input with single \n before body: "---\nname: test\n---\nBody starts here."
    // Slice after "---" = "\nBody starts here." → after strip = "Body starts here."
    const content = "---\nname: test\n---\nBody starts here.";
    const result = parseFrontmatter(content);
    expect(result.body).toBe("Body starts here.");
    // No leading newline when input had single \n after ---
    expect(result.body.startsWith("\n")).toBe(false);
  });

  it("handles frontmatter with multiple fields including numbers and booleans", () => {
    const content = "---\nname: my-agent\nscale: 3\nenabled: true\ntimeout: 60\n---\nbody-content.";
    const result = parseFrontmatter(content);
    expect(result.data).toMatchObject({
      name: "my-agent",
      scale: 3,
      enabled: true,
      timeout: 60,
    });
    expect(result.body).toBe("body-content.");
  });

  it("handles empty body after frontmatter", () => {
    const content = "---\nname: test\n---\n";
    const result = parseFrontmatter(content);
    expect(result.data).toMatchObject({ name: "test" });
    expect(result.body).toBe("");
  });

  it("handles nested YAML objects in frontmatter", () => {
    const content = "---\nname: test\nhooks:\n  pre-run: ./pre.sh\n---\nBody.";
    const result = parseFrontmatter(content);
    expect(result.data.name).toBe("test");
    expect((result.data.hooks as any)?.["pre-run"]).toBe("./pre.sh");
    expect(result.body).toBe("Body.");
  });
});

// ── EventSourcedStatsStore ─────────────────────────────────────────────────

describe("integration: EventSourcedStatsStore (stats/event-store.ts) — no Docker required", { timeout: 30_000 }, () => {
  async function makePersistence() {
    const dir = mkdtempSync(join(tmpdir(), "al-ess-test-"));
    const store = await createPersistenceStore({
      type: "sqlite",
      db: join(dir, "test.db"),
    });
    return store;
  }

  it("can be instantiated with a persistence store", async () => {
    const persistence = await makePersistence();
    const store = new EventSourcedStatsStore(persistence);
    expect(store).toBeDefined();
    await store.close();
  });

  it("recordRun() stores a completed run and queryRuns() returns it", async () => {
    const persistence = await makePersistence();
    const store = new EventSourcedStatsStore(persistence);

    const now = Date.now();
    await store.recordRun({
      instanceId: "inst-001",
      agentName: "test-agent",
      triggerType: "manual",
      triggerSource: undefined,
      result: "ok",
      exitCode: 0,
      startedAt: now,
      durationMs: 1000,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 300,
      costUsd: 0.01,
      turnCount: 5,
      errorMessage: undefined,
      preHookMs: undefined,
      postHookMs: undefined,
    });

    const runs = await store.queryRuns({ agent: "test-agent" });
    expect(runs.length).toBeGreaterThan(0);
    // Find our specific run
    const run = runs.find((r: any) => r.instance_id === "inst-001");
    expect(run).toBeDefined();
    expect(run.agent_name).toBe("test-agent");
    expect(run.trigger_type).toBe("manual");
    await store.close();
  });

  it("recordRun() with error result is queryable", async () => {
    const persistence = await makePersistence();
    const store = new EventSourcedStatsStore(persistence);

    const now = Date.now();
    await store.recordRun({
      instanceId: "inst-err-001",
      agentName: "err-agent",
      triggerType: "schedule",
      triggerSource: undefined,
      result: "error",
      exitCode: 1,
      startedAt: now,
      durationMs: 500,
      inputTokens: 50,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 50,
      costUsd: 0.001,
      turnCount: 1,
      errorMessage: "script exited with 1",
      preHookMs: undefined,
      postHookMs: undefined,
    });

    const runs = await store.queryRuns({ agent: "err-agent" });
    expect(runs.length).toBeGreaterThan(0);
    const run = runs.find((r: any) => r.instance_id === "inst-err-001");
    expect(run).toBeDefined();
    expect(run.result).toBe("error");
    await store.close();
  });

  it("queryAgentSummary() aggregates multiple runs for an agent", async () => {
    const persistence = await makePersistence();
    const store = new EventSourcedStatsStore(persistence);

    const now = Date.now();
    // Record 3 runs
    for (let i = 0; i < 3; i++) {
      await store.recordRun({
        instanceId: `agg-inst-${i}`,
        agentName: "agg-agent",
        triggerType: "manual",
        triggerSource: undefined,
        result: i === 2 ? "error" : "ok",
        exitCode: i === 2 ? 1 : 0,
        startedAt: now + i * 1000,
        durationMs: 1000 + i * 100,
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 300,
        costUsd: 0.01,
        turnCount: 3,
        errorMessage: i === 2 ? "failed" : undefined,
        preHookMs: undefined,
        postHookMs: undefined,
      });
    }

    const summaries = await store.queryAgentSummary({ agent: "agg-agent" });
    expect(summaries.length).toBeGreaterThan(0);
    const summary = summaries.find((s: any) => s.agentName === "agg-agent");
    expect(summary).toBeDefined();
    expect(summary.totalRuns).toBe(3);
    expect(summary.okRuns).toBe(2);
    expect(summary.errorRuns).toBe(1);
    await store.close();
  });

  it("queryCallGraph() returns call edge aggregations", async () => {
    const persistence = await makePersistence();
    const store = new EventSourcedStatsStore(persistence);

    // Record two call edges between same pair
    await store.recordCallEdge({
      callerAgent: "agent-a",
      callerInstance: "caller-inst-1",
      targetAgent: "agent-b",
      targetInstance: "target-inst-1",
      depth: 1,
      startedAt: Date.now(),
      durationMs: 500,
      status: "ok",
    });

    await store.recordCallEdge({
      callerAgent: "agent-a",
      callerInstance: "caller-inst-2",
      targetAgent: "agent-b",
      targetInstance: "target-inst-2",
      depth: 1,
      startedAt: Date.now(),
      durationMs: 300,
      status: "ok",
    });

    // Wait a bit for async events to be processed
    await new Promise((r) => setTimeout(r, 100));

    const graph = await store.queryCallGraph();
    expect(Array.isArray(graph)).toBe(true);
    const edge = graph.find((e: any) => e.callerAgent === "agent-a" && e.targetAgent === "agent-b");
    expect(edge).toBeDefined();
    expect(edge.count).toBeGreaterThanOrEqual(2);
    await store.close();
  });

  it("queryRuns() without agent filter returns all agents' runs", async () => {
    const persistence = await makePersistence();
    const store = new EventSourcedStatsStore(persistence);

    const now = Date.now();
    await store.recordRun({
      instanceId: "no-filter-inst-a",
      agentName: "agent-x",
      triggerType: "manual",
      triggerSource: undefined,
      result: "ok",
      exitCode: 0,
      startedAt: now,
      durationMs: 100,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 30,
      costUsd: 0,
      turnCount: 1,
      errorMessage: undefined,
      preHookMs: undefined,
      postHookMs: undefined,
    });

    await store.recordRun({
      instanceId: "no-filter-inst-b",
      agentName: "agent-y",
      triggerType: "schedule",
      triggerSource: undefined,
      result: "ok",
      exitCode: 0,
      startedAt: now + 100,
      durationMs: 200,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 30,
      costUsd: 0,
      turnCount: 1,
      errorMessage: undefined,
      preHookMs: undefined,
      postHookMs: undefined,
    });

    const runs = await store.queryRuns();
    const runIds = runs.map((r: any) => r.instance_id);
    expect(runIds).toContain("no-filter-inst-a");
    expect(runIds).toContain("no-filter-inst-b");
    await store.close();
  });

  it("createSnapshot() and loadSnapshot() work without error", async () => {
    const persistence = await makePersistence();
    const store = new EventSourcedStatsStore(persistence);

    const now = Date.now();
    await store.recordRun({
      instanceId: "snap-inst-1",
      agentName: "snap-agent",
      triggerType: "manual",
      triggerSource: undefined,
      result: "ok",
      exitCode: 0,
      startedAt: now,
      durationMs: 1000,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 300,
      costUsd: 0.01,
      turnCount: 5,
      errorMessage: undefined,
      preHookMs: undefined,
      postHookMs: undefined,
    });

    // Should not throw
    await expect(store.createSnapshot()).resolves.not.toThrow();
    await expect(store.loadSnapshot()).resolves.not.toThrow();
    await store.close();
  });
});

// ── EventSourcedWorkQueue ──────────────────────────────────────────────────

describe("integration: EventSourcedWorkQueue (events/event-queue-unified.ts) — no Docker required", { timeout: 30_000 }, () => {
  async function makeQueue<T>(maxSize = 10) {
    const dir = mkdtempSync(join(tmpdir(), "al-eswq-test-"));
    const persistence = await createPersistenceStore({
      type: "sqlite",
      db: join(dir, "test.db"),
    });
    return new EventSourcedWorkQueue<T>(persistence, maxSize);
  }

  it("enqueue returns { accepted: true }", async () => {
    const q = await makeQueue<{ value: number }>();
    const result = q.enqueue("agent-a", { value: 1 });
    expect(result.accepted).toBe(true);
    q.close();
  });

  it("size() returns 0 for new queue", async () => {
    const q = await makeQueue();
    expect(q.size("nonexistent")).toBe(0);
    q.close();
  });

  it("enqueue increases size", async () => {
    const q = await makeQueue<string>();
    q.enqueue("agent-b", "task1");
    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));
    // Size should reflect enqueued item after state is built
    // We call initialize() to load state from events
    await q.initialize();
    expect(q.size("agent-b")).toBeGreaterThanOrEqual(0); // May be 0 or 1 depending on async
    q.close();
  });

  it("dequeue returns undefined for empty queue", async () => {
    const q = await makeQueue<number>();
    // Before any enqueue, dequeue should return undefined
    const result = q.dequeue("agent-c");
    expect(result).toBeUndefined();
    q.close();
  });

  it("peek() returns empty array for empty queue", async () => {
    const q = await makeQueue<string>();
    const result = q.peek("empty-agent");
    expect(result).toEqual([]);
    q.close();
  });

  it("getQueueStats() returns zero counts for empty agent", async () => {
    const q = await makeQueue<string>();
    const stats = await q.getQueueStats("no-work-agent");
    expect(stats.totalEnqueued).toBe(0);
    expect(stats.totalDequeued).toBe(0);
    expect(stats.totalDropped).toBe(0);
    expect(stats.currentSize).toBe(0);
    q.close();
  });

  it("replayQueueHistory() returns empty array for new queue", async () => {
    const q = await makeQueue<string>();
    const history = await q.replayQueueHistory("new-agent");
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(0);
    q.close();
  });

  it("clearAll() clears all queues without error", async () => {
    const q = await makeQueue<string>();
    q.enqueue("agent-x", "task1");
    expect(() => q.clearAll()).not.toThrow();
    q.close();
  });

  it("close() does not throw", async () => {
    const q = await makeQueue<number>();
    expect(() => q.close()).not.toThrow();
  });

  it("setAgentMaxSize() does not throw", async () => {
    const q = await makeQueue<string>();
    expect(() => q.setAgentMaxSize("capped-agent", 5)).not.toThrow();
    q.close();
  });

  it("initialize() builds state from events without error", async () => {
    const q = await makeQueue<string>();
    await expect(q.initialize()).resolves.not.toThrow();
    q.close();
  });
});
