import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { rmSync } from "fs";
import { makeTmpProject, captureLog } from "../../helpers.js";
import { execute } from "../../../src/cli/commands/status.js";

describe("status summary", () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("shows unified agents table with trigger types", async () => {
    tmpDir = makeTmpProject();
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    // Table headers
    expect(output).toContain("AGENT");
    expect(output).toContain("TRIGGER");
    expect(output).toContain("STATUS");
    expect(output).toContain("INSTANCES");
    expect(output).toContain("QUEUE");
    // Agents appear in the table
    expect(output).toContain("dev");
    expect(output).toContain("reviewer");
    expect(output).toContain("devops");
    // All default agents have schedules, so trigger column shows "cron"
    expect(output).toContain("cron");
  });

  it("shows (manual) for agents without schedule or webhooks", async () => {
    tmpDir = makeTmpProject({
      agents: [
        { name: "manual-agent", schedule: undefined },
      ],
    });
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("manual-agent");
    expect(output).toContain("(manual)");
  });

  it("shows cron + webhook for agents with both triggers", async () => {
    tmpDir = makeTmpProject({
      agents: [
        {
          name: "multi-trigger",
          schedule: "*/5 * * * *",
          webhooks: [{ source: "github" }],
        },
      ],
    });
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("cron + webhook");
  });
});

describe("status per-agent detail", () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("shows agent config details", async () => {
    tmpDir = makeTmpProject();
    const output = await captureLog(() => execute({ project: tmpDir, agent: "devops" }));
    expect(output).toContain("Agent: devops");
    expect(output).toContain("Schedule: */15 * * * *");
  });

  it("shows webhook details for agent with webhooks", async () => {
    tmpDir = makeTmpProject({
      agents: [
        {
          name: "wh-agent",
          webhooks: [
            { source: "github", events: ["issues.opened", "pull_request"] },
          ],
        },
      ],
    });
    const output = await captureLog(() => execute({ project: tmpDir, agent: "wh-agent" }));
    expect(output).toContain("Agent: wh-agent");
    expect(output).toContain("Webhooks:");
    expect(output).toContain("github: issues.opened, pull_request");
  });
});

describe("status with queue sizes", () => {
  let tmpDir: string;
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("displays queue sizes from gateway response", async () => {
    tmpDir = makeTmpProject({
      agents: [{ name: "wh-agent", webhooks: [{ source: "github" }] }],
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        scheduler: { paused: false, mode: "local" },
        instances: [],
        agents: [{ name: "wh-agent", enabled: true }],
        running: 0,
        queueSizes: { "wh-agent": 3 },
      })),
    });
    // /locks/status
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("QUEUE");
    expect(output).toContain("3");
  });

  it("shows 0 queue size when queueSizes absent from response", async () => {
    tmpDir = makeTmpProject({
      agents: [{ name: "wh-agent", webhooks: [{ source: "github" }] }],
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        scheduler: { paused: false, mode: "local" },
        instances: [],
        agents: [{ name: "wh-agent", enabled: true }],
        running: 0,
      })),
    });
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("QUEUE");
    // Queue size defaults to 0
    expect(output).toMatch(/wh-agent.+0\s*$/m);
  });
});

describe("status with locks", () => {
  let tmpDir: string;
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("displays active locks when gateway is running", async () => {
    tmpDir = makeTmpProject();
    const mockLocks = {
      locks: [
        { resourceKey: "github issue acme/app#42", agentName: "dev-agent", heldSince: Date.now() - 30000 },
        { resourceKey: "github pr acme/app#45", agentName: "reviewer-agent", heldSince: Date.now() - 60000 },
      ]
    };

    // Mock the first call to /control/status (which fails/returns empty)
    fetchSpy.mockResolvedValueOnce({
      ok: false,
    });

    // Mock the second call to /locks/status
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockLocks)),
    });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("Active locks:");
    expect(output).toContain("dev-agent: github issue acme/app#42");
    expect(output).toContain("reviewer-agent: github pr acme/app#45");
    expect(output).toContain("held for");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8080/locks/status",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("handles empty locks gracefully", async () => {
    tmpDir = makeTmpProject();
    // First call: /control/status
    fetchSpy.mockResolvedValueOnce({ ok: false });
    // Second call: /locks/status
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ locks: [] })),
    });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).not.toContain("Active locks:");
    expect(output).toContain("AL Status");
  });

  it("handles gateway not running gracefully", async () => {
    tmpDir = makeTmpProject();
    fetchSpy.mockRejectedValue(new Error("fetch failed"));

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    expect(output).not.toContain("Active locks:");
  });

  it("handles gateway returning error status gracefully", async () => {
    tmpDir = makeTmpProject();
    fetchSpy.mockResolvedValue({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    expect(output).not.toContain("Active locks:");
  });
});

describe("status printAgentConfig — repos filter and scale/timeout", () => {
  let tmpDir: string;
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no gateway"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("shows repos filter in webhook config", async () => {
    tmpDir = makeTmpProject({
      agents: [
        {
          name: "wh-repos",
          webhooks: [
            { source: "github", events: ["push"], repos: ["owner/repo1", "owner/repo2"] },
          ],
        },
      ],
    });

    const output = await captureLog(() => execute({ project: tmpDir, agent: "wh-repos" }));
    expect(output).toContain("Webhooks:");
    expect(output).toContain("repos: owner/repo1, owner/repo2");
  });

  it("shows scale in agent config when scale > 1", async () => {
    tmpDir = makeTmpProject({
      agents: [{ name: "scaled-agent", scale: 3 }],
    });

    const output = await captureLog(() => execute({ project: tmpDir, agent: "scaled-agent" }));
    expect(output).toContain("Scale: 3");
  });

  it("shows timeout in agent config when timeout is set", async () => {
    tmpDir = makeTmpProject({
      agents: [{ name: "timeout-agent", timeout: 3600 }],
    });

    const output = await captureLog(() => execute({ project: tmpDir, agent: "timeout-agent" }));
    expect(output).toContain("Timeout: 3600s");
  });
});

describe("status with running instances from gateway", () => {
  let tmpDir: string;
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("shows running instances table in summary view", async () => {
    tmpDir = makeTmpProject({
      agents: [{ name: "dev" }],
    });

    const now = Date.now();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        scheduler: { paused: false, mode: "local" },
        instances: [
          {
            id: "dev-abc12345678901234567",
            agentName: "dev",
            status: "running",
            trigger: "manual",
            startedAt: now - 60000,
          },
        ],
        agents: [{ name: "dev", enabled: true }],
        running: 1,
        queueSizes: {},
      })),
    });
    fetchSpy.mockResolvedValueOnce({ ok: false }); // /locks/status

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("Running Instances:");
    expect(output).toContain("INSTANCE ID");
    expect(output).toContain("dev");
    expect(output).toContain("running");
    expect(output).toContain("manual");
  });

  it("shows PAUSED status for disabled agent in per-agent detail", async () => {
    tmpDir = makeTmpProject();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        scheduler: { paused: false, mode: "local" },
        instances: [],
        agents: [{ name: "dev", enabled: false }],
        running: 0,
        queueSizes: {},
      })),
    });
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir, agent: "dev" }));
    expect(output).toContain("Agent: dev");
    expect(output).toContain("Status: PAUSED");
  });

  it("shows running instances for specific agent in per-agent detail", async () => {
    tmpDir = makeTmpProject();

    const now = Date.now();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        scheduler: { paused: false, mode: "local" },
        instances: [
          {
            id: "dev-instance-1",
            agentName: "dev",
            status: "running",
            trigger: "cron",
            startedAt: now - 30000,
          },
        ],
        agents: [{ name: "dev", enabled: true }],
        running: 1,
        queueSizes: {},
      })),
    });
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir, agent: "dev" }));
    expect(output).toContain("Agent: dev");
    expect(output).toContain("Running Instances:");
    expect(output).toContain("dev");
    expect(output).toContain("running");
  });

  it("shows scheduler runtime and gateway port in summary view", async () => {
    tmpDir = makeTmpProject({
      agents: [{ name: "dev" }],
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        scheduler: {
          paused: false,
          mode: "local",
          runtime: "docker",
          gatewayPort: 9090,
        },
        instances: [],
        agents: [{ name: "dev", enabled: true }],
        running: 0,
        queueSizes: {},
      })),
    });
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("Runtime: docker");
    expect(output).toContain("Gateway: http://localhost:9090");
    expect(output).toContain("No running instances.");
  });

  it("shows truncated instance ID when ID is long", async () => {
    tmpDir = makeTmpProject({
      agents: [{ name: "dev" }],
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        scheduler: { paused: false, mode: "local" },
        instances: [
          {
            id: "dev-abcdef1234567890abcdef1234567890",  // very long ID
            agentName: "dev",
            status: "running",
            trigger: null,
            startedAt: Date.now() - 10000,
          },
        ],
        agents: [{ name: "dev", enabled: true }],
        running: 1,
        queueSizes: {},
      })),
    });
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("...");  // truncated ID
    expect(output).toContain("-");    // dash for no trigger
  });
});
