/**
 * Tests for CLI commands that communicate with the gateway via HTTP:
 * kill, pause, resume, stop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { makeTmpProject, captureLog } from "../../helpers.js";

// ─── Mock gateway-client ────────────────────────────────────────────────────

const { mockGatewayFetch, mockGatewayJson } = vi.hoisted(() => ({
  mockGatewayFetch: vi.fn(),
  mockGatewayJson: vi.fn(),
}));

vi.mock("../../../src/cli/gateway-client.js", () => ({
  gatewayFetch: mockGatewayFetch,
  gatewayJson: mockGatewayJson,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeOkResponse(body: Record<string, unknown> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeNotFoundResponse(body: Record<string, unknown> = {}): Response {
  return {
    ok: false,
    status: 404,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeErrorResponse(body: Record<string, unknown> = {}): Response {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ─── kill command ───────────────────────────────────────────────────────────

describe("kill command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpProject();
    mockGatewayFetch.mockReset();
    mockGatewayJson.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("kills an agent by name and logs the response message", async () => {
    const { execute } = await import("../../../src/cli/commands/kill.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Agent dev killed (2 instances)." });

    const output = await captureLog(() => execute("dev", { project: tmpDir }));

    expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.path).toBe("/control/agents/dev/kill");
    expect(callArgs.method).toBe("POST");
    expect(output).toContain("Agent dev killed");
  });

  it("falls back to instance-kill when agent-kill returns 404", async () => {
    const { execute } = await import("../../../src/cli/commands/kill.js");

    mockGatewayFetch
      .mockResolvedValueOnce(makeNotFoundResponse())
      .mockResolvedValueOnce(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Instance abc123 killed." });

    const output = await captureLog(() => execute("abc123", { project: tmpDir }));

    expect(mockGatewayFetch).toHaveBeenCalledTimes(2);
    const secondCall = mockGatewayFetch.mock.calls[1][0];
    expect(secondCall.path).toBe("/control/kill/abc123");
    expect(output).toContain("Instance abc123 killed");
  });

  it("throws a friendly error when the gateway is not running (ECONNREFUSED)", async () => {
    const { execute } = await import("../../../src/cli/commands/kill.js");

    mockGatewayFetch.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8080"));

    await expect(execute("dev", { project: tmpDir })).rejects.toThrow(
      "Scheduler not running"
    );
  });

  it("rethrows non-ECONNREFUSED errors unchanged", async () => {
    const { execute } = await import("../../../src/cli/commands/kill.js");

    mockGatewayFetch.mockRejectedValue(new Error("Network timeout"));

    await expect(execute("dev", { project: tmpDir })).rejects.toThrow("Network timeout");
  });

  it("throws with the error message from the gateway when response is not ok", async () => {
    const { execute } = await import("../../../src/cli/commands/kill.js");

    mockGatewayFetch.mockResolvedValue(makeErrorResponse());
    mockGatewayJson.mockResolvedValue({ error: "Agent not found" });

    await expect(execute("nonexistent", { project: tmpDir })).rejects.toThrow(
      "Agent not found"
    );
  });

  it("URL-encodes the target in the request path", async () => {
    const { execute } = await import("../../../src/cli/commands/kill.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "killed" });

    await captureLog(() => execute("my agent", { project: tmpDir }));

    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.path).toBe("/control/agents/my%20agent/kill");
  });
});

// ─── pause command ──────────────────────────────────────────────────────────

describe("pause command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpProject();
    mockGatewayFetch.mockReset();
    mockGatewayJson.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pauses the entire scheduler when no agent name is given", async () => {
    const { execute } = await import("../../../src/cli/commands/pause.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Scheduler paused." });

    const output = await captureLog(() => execute(undefined, { project: tmpDir }));

    expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.path).toBe("/control/pause");
    expect(callArgs.method).toBe("POST");
    expect(output).toContain("Scheduler paused");
  });

  it("pauses a specific agent when name is provided", async () => {
    const { execute } = await import("../../../src/cli/commands/pause.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Agent dev paused." });

    const output = await captureLog(() => execute("dev", { project: tmpDir }));

    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.path).toBe("/control/agents/dev/pause");
    expect(output).toContain("Agent dev paused");
  });

  it("throws a friendly error when the gateway is not running (ECONNREFUSED)", async () => {
    const { execute } = await import("../../../src/cli/commands/pause.js");

    mockGatewayFetch.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8080"));

    await expect(execute(undefined, { project: tmpDir })).rejects.toThrow(
      "Scheduler not running"
    );
  });

  it("throws with the gateway error message when response is not ok", async () => {
    const { execute } = await import("../../../src/cli/commands/pause.js");

    mockGatewayFetch.mockResolvedValue(makeErrorResponse());
    mockGatewayJson.mockResolvedValue({ error: "Already paused" });

    await expect(execute(undefined, { project: tmpDir })).rejects.toThrow("Already paused");
  });
});

// ─── resume command ─────────────────────────────────────────────────────────

describe("resume command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpProject();
    mockGatewayFetch.mockReset();
    mockGatewayJson.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resumes the entire scheduler when no agent name is given", async () => {
    const { execute } = await import("../../../src/cli/commands/resume.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Scheduler resumed." });

    const output = await captureLog(() => execute(undefined, { project: tmpDir }));

    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.path).toBe("/control/resume");
    expect(callArgs.method).toBe("POST");
    expect(output).toContain("Scheduler resumed");
  });

  it("resumes a specific agent when name is provided", async () => {
    const { execute } = await import("../../../src/cli/commands/resume.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Agent dev resumed." });

    const output = await captureLog(() => execute("dev", { project: tmpDir }));

    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.path).toBe("/control/agents/dev/resume");
    expect(output).toContain("Agent dev resumed");
  });

  it("throws a friendly error when the gateway is not running (ECONNREFUSED)", async () => {
    const { execute } = await import("../../../src/cli/commands/resume.js");

    mockGatewayFetch.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8080"));

    await expect(execute(undefined, { project: tmpDir })).rejects.toThrow(
      "Scheduler not running"
    );
  });

  it("rethrows other errors unchanged", async () => {
    const { execute } = await import("../../../src/cli/commands/resume.js");

    mockGatewayFetch.mockRejectedValue(new Error("Unexpected error"));

    await expect(execute("dev", { project: tmpDir })).rejects.toThrow("Unexpected error");
  });

  it("throws with the gateway error message when response is not ok", async () => {
    const { execute } = await import("../../../src/cli/commands/resume.js");

    mockGatewayFetch.mockResolvedValue(makeErrorResponse());
    mockGatewayJson.mockResolvedValue({ error: "Not paused" });

    await expect(execute(undefined, { project: tmpDir })).rejects.toThrow("Not paused");
  });
});

// ─── stop command ───────────────────────────────────────────────────────────

describe("stop command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpProject();
    mockGatewayFetch.mockReset();
    mockGatewayJson.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sends a POST to /control/stop and logs the response message", async () => {
    const { execute } = await import("../../../src/cli/commands/stop.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Scheduler stopped." });

    const output = await captureLog(() => execute({ project: tmpDir }));

    expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.path).toBe("/control/stop");
    expect(callArgs.method).toBe("POST");
    expect(output).toContain("Scheduler stopped");
  });

  it("throws a friendly error when the gateway is not running (ECONNREFUSED)", async () => {
    const { execute } = await import("../../../src/cli/commands/stop.js");

    mockGatewayFetch.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8080"));

    await expect(execute({ project: tmpDir })).rejects.toThrow("Scheduler not running");
  });

  it("rethrows non-ECONNREFUSED errors unchanged", async () => {
    const { execute } = await import("../../../src/cli/commands/stop.js");

    mockGatewayFetch.mockRejectedValue(new Error("Timeout"));

    await expect(execute({ project: tmpDir })).rejects.toThrow("Timeout");
  });

  it("throws with the gateway error message when response is not ok", async () => {
    const { execute } = await import("../../../src/cli/commands/stop.js");

    mockGatewayFetch.mockResolvedValue(makeErrorResponse());
    mockGatewayJson.mockResolvedValue({ error: "Scheduler already stopped" });

    await expect(execute({ project: tmpDir })).rejects.toThrow("Scheduler already stopped");
  });

  it("passes the env option to the gateway client", async () => {
    const { execute } = await import("../../../src/cli/commands/stop.js");

    mockGatewayFetch.mockResolvedValue(makeOkResponse());
    mockGatewayJson.mockResolvedValue({ message: "Stopped." });

    await captureLog(() => execute({ project: tmpDir, env: "production" }));

    const callArgs = mockGatewayFetch.mock.calls[0][0];
    expect(callArgs.env).toBe("production");
  });
});
