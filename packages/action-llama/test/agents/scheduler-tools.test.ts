import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Pi extension imports
vi.mock("@mariozechner/pi-coding-agent", () => ({
  defineTool: (tool: any) => tool,
}));

const { createSchedulerTools } = await import("../../src/agents/scheduler-tools.js");

// ── Test helpers ──────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => makeLogger()),
  } as any;
}

function makeLockStore() {
  return {
    acquire: vi.fn(() => ({ ok: true })),
    release: vi.fn(() => ({ ok: true })),
    heartbeat: vi.fn(() => ({ ok: true })),
    list: vi.fn(() => []),
  } as any;
}

function makeCallStore() {
  return {
    create: vi.fn(() => ({
      callId: "call-123",
      callerAgent: "agent-a",
      callerInstanceId: "inst-a",
      targetAgent: "agent-b",
      context: "do something",
      status: "pending",
      createdAt: Date.now(),
      depth: 0,
    })),
    check: vi.fn(() => null),
    setRunning: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  } as any;
}

function makeStatusTracker() {
  return {
    setAgentStatusText: vi.fn(),
    setAgentError: vi.fn(),
    setAgentState: vi.fn(),
    startRun: vi.fn(),
    endRun: vi.fn(),
    addLogLine: vi.fn(),
    registerInstance: vi.fn(),
    completeInstance: vi.fn(),
    isPaused: vi.fn(() => false),
  } as any;
}

function makeOpts(overrides?: any) {
  return {
    lockStore: makeLockStore(),
    callStore: makeCallStore(),
    dispatchCall: vi.fn(() => ({ ok: true })),
    statusTracker: makeStatusTracker(),
    logger: makeLogger(),
    agentName: "test-agent",
    instanceId: "test-agent-abc123",
    depth: 0,
    onReturnValue: vi.fn(),
    ...overrides,
  };
}

async function callTool(tools: any[], name: string, params: any) {
  const tool = tools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool.execute("tc-1", params, undefined, undefined, {} as any);
}

// ── Tests ─────────────────────────────────────────────────────

describe("Scheduler Tools", () => {
  describe("createSchedulerTools", () => {
    it("creates all six tools", () => {
      const tools = createSchedulerTools(makeOpts());
      const names = tools.map((t: any) => t.name);
      expect(names).toEqual([
        "acquire_lock",
        "release_lock",
        "call_agent",
        "check_call",
        "set_status",
        "return_value",
      ]);
    });

    it("all tools have required fields", () => {
      const tools = createSchedulerTools(makeOpts());
      for (const tool of tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("label");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("parameters");
        expect(tool).toHaveProperty("execute");
        expect(typeof tool.execute).toBe("function");
      }
    });
  });

  describe("acquire_lock", () => {
    it("acquires a lock successfully", async () => {
      const opts = makeOpts();
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "acquire_lock", {
        resource_key: "lock://repo/main",
      });

      expect(opts.lockStore.acquire).toHaveBeenCalledWith(
        "lock://repo/main",
        "test-agent-abc123",
        undefined,
      );
      expect(result.content[0].text).toContain("Lock acquired");
    });

    it("passes TTL when provided", async () => {
      const opts = makeOpts();
      const tools = createSchedulerTools(opts);

      await callTool(tools, "acquire_lock", {
        resource_key: "lock://repo/main",
        ttl_seconds: 60,
      });

      expect(opts.lockStore.acquire).toHaveBeenCalledWith(
        "lock://repo/main",
        "test-agent-abc123",
        60,
      );
    });

    it("reports when lock is held by another", async () => {
      const opts = makeOpts();
      opts.lockStore.acquire.mockReturnValue({
        ok: false,
        holder: "other-agent-xyz",
      });
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "acquire_lock", {
        resource_key: "lock://repo/main",
      });

      expect(result.content[0].text).toContain("Lock not acquired");
      expect(result.content[0].text).toContain("other-agent-xyz");
    });

    it("reports deadlock detection", async () => {
      const opts = makeOpts();
      opts.lockStore.acquire.mockReturnValue({
        ok: false,
        deadlock: true,
        cycle: ["agent-a", "agent-b", "agent-a"],
      });
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "acquire_lock", {
        resource_key: "lock://repo/main",
      });

      expect(result.content[0].text).toContain("Deadlock detected");
      expect(result.content[0].text).toContain("agent-a");
    });
  });

  describe("release_lock", () => {
    it("releases a lock successfully", async () => {
      const opts = makeOpts();
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "release_lock", {
        resource_key: "lock://repo/main",
      });

      expect(opts.lockStore.release).toHaveBeenCalledWith(
        "lock://repo/main",
        "test-agent-abc123",
      );
      expect(result.content[0].text).toContain("Lock released");
    });

    it("reports failure reason", async () => {
      const opts = makeOpts();
      opts.lockStore.release.mockReturnValue({
        ok: false,
        reason: "not held by you",
      });
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "release_lock", {
        resource_key: "lock://repo/main",
      });

      expect(result.content[0].text).toContain("not held by you");
    });
  });

  describe("call_agent", () => {
    it("dispatches a call and returns call_id", async () => {
      const opts = makeOpts();
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "call_agent", {
        target_agent: "agent-b",
        context: "review the PR",
      });

      expect(opts.callStore.create).toHaveBeenCalledWith({
        callerAgent: "test-agent",
        callerInstanceId: "test-agent-abc123",
        targetAgent: "agent-b",
        context: "review the PR",
        depth: 0,
      });
      expect(opts.dispatchCall).toHaveBeenCalled();
      expect(result.content[0].text).toContain("call-123");
      expect(result.content[0].text).toContain("dispatched");
    });

    it("reports rejection", async () => {
      const opts = makeOpts();
      opts.dispatchCall.mockReturnValue({ ok: false, reason: "agent not found" });
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "call_agent", {
        target_agent: "nonexistent",
        context: "hello",
      });

      expect(opts.callStore.fail).toHaveBeenCalledWith("call-123", "agent not found");
      expect(result.content[0].text).toContain("rejected");
      expect(result.content[0].text).toContain("agent not found");
    });
  });

  describe("check_call", () => {
    it("returns completed status with return value", async () => {
      const opts = makeOpts();
      opts.callStore.check.mockReturnValue({
        status: "completed",
        returnValue: "PR approved",
      });
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "check_call", {
        call_id: "call-123",
      });

      expect(opts.callStore.check).toHaveBeenCalledWith("call-123", "test-agent-abc123");
      expect(result.content[0].text).toContain("completed");
      expect(result.content[0].text).toContain("PR approved");
    });

    it("returns pending status", async () => {
      const opts = makeOpts();
      opts.callStore.check.mockReturnValue({ status: "pending" });
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "check_call", {
        call_id: "call-123",
      });

      expect(result.content[0].text).toContain("pending");
      expect(result.content[0].text).toContain("check_call again");
    });

    it("returns error status", async () => {
      const opts = makeOpts();
      opts.callStore.check.mockReturnValue({
        status: "error",
        errorMessage: "target agent crashed",
      });
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "check_call", {
        call_id: "call-123",
      });

      expect(result.content[0].text).toContain("failed");
      expect(result.content[0].text).toContain("target agent crashed");
    });

    it("handles unknown call_id", async () => {
      const opts = makeOpts();
      opts.callStore.check.mockReturnValue(null);
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "check_call", {
        call_id: "unknown-id",
      });

      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("set_status", () => {
    it("updates status text", async () => {
      const opts = makeOpts();
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "set_status", {
        text: "reviewing PR #42",
      });

      expect(opts.statusTracker.setAgentStatusText).toHaveBeenCalledWith(
        "test-agent",
        "reviewing PR #42",
      );
      expect(result.content[0].text).toContain("reviewing PR #42");
    });

    it("works without status tracker", async () => {
      const opts = makeOpts({ statusTracker: undefined });
      const tools = createSchedulerTools(opts);

      // Should not throw
      const result = await callTool(tools, "set_status", {
        text: "working",
      });

      expect(result.content[0].text).toContain("working");
    });
  });

  describe("return_value", () => {
    it("calls onReturnValue callback", async () => {
      const opts = makeOpts();
      const tools = createSchedulerTools(opts);

      const result = await callTool(tools, "return_value", {
        value: "PR #42 approved with minor comments",
      });

      expect(opts.onReturnValue).toHaveBeenCalledWith("PR #42 approved with minor comments");
      expect(result.content[0].text).toContain("Return value set");
    });
  });
});
