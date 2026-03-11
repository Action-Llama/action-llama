import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { rmSync } from "fs";
import { makeTmpProject, captureLog } from "../../helpers.js";
import { execute } from "../../../src/cli/commands/status.js";

describe("status", () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("shows status for all agents", async () => {
    tmpDir = makeTmpProject();
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    expect(output).toContain("dev:");
    expect(output).toContain("reviewer:");
    expect(output).toContain("devops:");
  });

  it("shows schedule", async () => {
    tmpDir = makeTmpProject();
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("Schedule:");
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
    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:8080/locks/status");
  });

  it("handles empty locks gracefully", async () => {
    tmpDir = makeTmpProject();
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
    fetchSpy.mockRejectedValueOnce(new Error("fetch failed"));

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    expect(output).not.toContain("Active locks:");
  });

  it("handles gateway returning error status gracefully", async () => {
    tmpDir = makeTmpProject();
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    expect(output).not.toContain("Active locks:");
  });
});
