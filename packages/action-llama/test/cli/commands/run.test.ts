import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";
import { makeTmpProject, captureLog } from "../../helpers.js";

// Mock gateway-client
const mockGatewayFetch = vi.fn();
vi.mock("../../../src/cli/gateway-client.js", async () => {
  const actual = await vi.importActual("../../../src/cli/gateway-client.js") as any;
  return {
    gatewayFetch: (...args: any[]) => mockGatewayFetch(...args),
    gatewayJson: actual.gatewayJson,
  };
});

// Mock credentials (needed by gateway-client's transitive imports)
vi.mock("../../../src/shared/credentials.js", async () => {
  const actual = await vi.importActual("../../../src/shared/credentials.js") as any;
  return {
    ...actual,
    loadCredentialField: vi.fn().mockReturnValue("mock-key"),
    parseCredentialRef: actual.parseCredentialRef,
  };
});

import { execute } from "../../../src/cli/commands/run.js";

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers an agent run via the gateway", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    mockGatewayFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ success: true, message: "Agent dev triggered" }),
    });

    const output = await captureLog(async () => {
      await execute("dev", undefined, { project: dir });
    });

    expect(mockGatewayFetch).toHaveBeenCalledWith({
      project: resolve(dir),
      path: "/control/trigger/dev",
      method: "POST",
      body: undefined,
      env: undefined,
    });
    expect(output).toContain("Agent dev triggered");
  });

  it("passes prompt as JSON body when provided", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    mockGatewayFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ success: true, message: "Agent dev triggered" }),
    });

    await execute("dev", "review PR #42", { project: dir });

    expect(mockGatewayFetch).toHaveBeenCalledWith(
      expect.objectContaining({ body: { prompt: "review PR #42" } }),
    );
  });

  it("passes env option to gateway fetch", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    mockGatewayFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ success: true, message: "Agent dev triggered" }),
    });

    await execute("dev", undefined, { project: dir, env: "staging" });

    expect(mockGatewayFetch).toHaveBeenCalledWith(
      expect.objectContaining({ env: "staging" }),
    );
  });

  it("throws when scheduler is not running", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    mockGatewayFetch.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await expect(execute("dev", undefined, { project: dir })).rejects.toThrow(
      "Scheduler not running. Start it with 'al start'."
    );
  });

  it("throws when gateway returns an error", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    mockGatewayFetch.mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: "Agent dev not found or all runners busy" }),
    });

    await expect(execute("dev", undefined, { project: dir })).rejects.toThrow(
      "Agent dev not found or all runners busy"
    );
  });

  it("throws if agent does not exist", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    await expect(execute("nonexistent", undefined, { project: dir })).rejects.toThrow(
      'Agent "nonexistent" not found'
    );
  });

  it("lists available agents in error message", async () => {
    const dir = makeTmpProject({
      agents: [
        { name: "dev", schedule: "*/5 * * * *" },
        { name: "reviewer", schedule: "*/5 * * * *" },
      ],
    });

    await expect(execute("nope", undefined, { project: dir })).rejects.toThrow("Available agents: dev, reviewer");
  });

  it("throws if run from an agent directory", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", schedule: "*/5 * * * *" }],
    });

    // Point at the agent subdir instead of the project root
    await expect(execute("dev", undefined, { project: resolve(dir, "agents", "dev") })).rejects.toThrow(
      "looks like an agent directory"
    );
  });
});
