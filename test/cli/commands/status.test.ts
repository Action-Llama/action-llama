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
      json: () => Promise.resolve(mockLocks),
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
      json: () => Promise.resolve({ locks: [] }),
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
