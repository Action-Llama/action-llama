import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSchedulerTools, type SchedulerToolsOpts } from "../../src/agents/scheduler-tools.js";
import type { WaitFilter } from "../../src/execution/waiting-registry.js";

function makeOpts(overrides: Partial<SchedulerToolsOpts> = {}): SchedulerToolsOpts {
  return {
    lockStore: {
      acquire: vi.fn().mockReturnValue({ ok: true }),
      release: vi.fn().mockReturnValue({ ok: true }),
      getHoldings: vi.fn().mockReturnValue([]),
      releaseAll: vi.fn(),
    } as any,
    callStore: {
      create: vi.fn().mockReturnValue({ callId: "test-call" }),
      check: vi.fn(),
      setRunning: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    } as any,
    dispatchCall: vi.fn().mockReturnValue({ ok: true }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as any,
    agentName: "test-agent",
    sessionId: "test-instance",
    depth: 0,
    onReturnValue: vi.fn(),
    ...overrides,
  };
}

describe("wait_for_trigger tool", () => {
  it("is not included when onWait is not provided", () => {
    const tools = createSchedulerTools(makeOpts());
    const waitTool = tools.find((t) => t.name === "wait_for_trigger");
    expect(waitTool).toBeUndefined();
  });

  it("is included when onWait is provided", () => {
    const tools = createSchedulerTools(makeOpts({ onWait: vi.fn() }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger");
    expect(waitTool).toBeDefined();
  });

  it("calls onWait with webhook filter and returns payload", async () => {
    const payload = { source: "github", event: "push", repo: "owner/repo", sender: "user" };
    const onWait = vi.fn().mockResolvedValue(payload);

    const tools = createSchedulerTools(makeOpts({ onWait }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger")!;

    const result = await waitTool.execute("tc-1", {
      type: "webhook",
      source: "github",
      event: "push",
    });

    expect(onWait).toHaveBeenCalledWith(
      { type: "webhook", source: "github", event: "push", match: undefined },
      1800 * 1000, // default timeout
    );

    const text = (result as any).content[0].text;
    expect(text).toContain("Trigger received");
    expect(text).toContain("github");
  });

  it("calls onWait with agent-trigger filter", async () => {
    const onWait = vi.fn().mockResolvedValue({ type: "agent-trigger", sourceAgent: "deployer" });

    const tools = createSchedulerTools(makeOpts({ onWait }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger")!;

    await waitTool.execute("tc-2", {
      type: "agent_trigger",
      source_agent: "deployer",
    });

    expect(onWait).toHaveBeenCalledWith(
      { type: "agent-trigger", sourceAgent: "deployer" },
      1800 * 1000,
    );
  });

  it("parses custom timeout", async () => {
    const onWait = vi.fn().mockResolvedValue({});

    const tools = createSchedulerTools(makeOpts({ onWait }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger")!;

    await waitTool.execute("tc-3", {
      type: "webhook",
      timeout: "2h",
    });

    expect(onWait).toHaveBeenCalledWith(
      expect.any(Object),
      2 * 3600 * 1000,
    );
  });

  it("parses compound timeout (1h30m)", async () => {
    const onWait = vi.fn().mockResolvedValue({});

    const tools = createSchedulerTools(makeOpts({ onWait }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger")!;

    await waitTool.execute("tc-4", {
      type: "webhook",
      timeout: "1h30m",
    });

    expect(onWait).toHaveBeenCalledWith(
      expect.any(Object),
      (60 + 30) * 60 * 1000,
    );
  });

  it("uses defaultWaitTimeout from opts", async () => {
    const onWait = vi.fn().mockResolvedValue({});

    const tools = createSchedulerTools(makeOpts({ onWait, defaultWaitTimeout: 600 }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger")!;

    await waitTool.execute("tc-5", { type: "webhook" });

    expect(onWait).toHaveBeenCalledWith(
      expect.any(Object),
      600 * 1000,
    );
  });

  it("returns error message on timeout", async () => {
    const onWait = vi.fn().mockRejectedValue(new Error("Wait timeout expired"));

    const tools = createSchedulerTools(makeOpts({ onWait }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger")!;

    const result = await waitTool.execute("tc-6", { type: "webhook" });

    const text = (result as any).content[0].text;
    expect(text).toContain("Wait failed");
    expect(text).toContain("timeout");
  });

  it("passes match predicates through", async () => {
    const onWait = vi.fn().mockResolvedValue({});

    const tools = createSchedulerTools(makeOpts({ onWait }));
    const waitTool = tools.find((t) => t.name === "wait_for_trigger")!;

    await waitTool.execute("tc-7", {
      type: "webhook",
      source: "github",
      event: "pull_request",
      match: { action: "closed", "pull_request.merged": "true" },
    });

    expect(onWait).toHaveBeenCalledWith(
      {
        type: "webhook",
        source: "github",
        event: "pull_request",
        match: { action: "closed", "pull_request.merged": "true" },
      },
      expect.any(Number),
    );
  });
});
