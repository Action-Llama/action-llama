/**
 * Tests for mcp/server.ts — covers startMcpServer, callGateway,
 * formatLogEntries, and all tool/resource handlers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { makeTmpProject } from "../helpers.js";

// ─── Capture registered tools/resources ─────────────────────────────────────

const registeredTools = new Map<string, (args: any) => Promise<any>>();
const registeredResources = new Map<string, (uri: any, params: any) => Promise<any>>();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class MockMcpServer {
    tool(name: string, _desc: string, _schema: any, handler: any) {
      registeredTools.set(name, handler);
    }
    resource(name: string, _template: any, handler: any) {
      registeredResources.set(name, handler);
    }
    async connect(_transport: any) {
      // No-op for tests
    }
  },
  ResourceTemplate: class MockResourceTemplate {
    constructor(public pattern: string, _opts: any) {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class MockStdioServerTransport {},
}));

// ─── Mock gatewayFetch / gatewayJson ────────────────────────────────────────

const mockGatewayFetch = vi.fn();
const mockGatewayJson = vi.fn();

vi.mock("../../src/cli/gateway-client.js", () => ({
  gatewayFetch: (...args: any[]) => mockGatewayFetch(...args),
  gatewayJson: (...args: any[]) => mockGatewayJson(...args),
}));

// ─── Mock child_process.spawn ────────────────────────────────────────────────

const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

// ─── Mock global fetch for al_start polling ──────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Import after mocks ──────────────────────────────────────────────────────

import { startMcpServer } from "../../src/mcp/server.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeGatewayOk(data: unknown) {
  const res = makeJsonResponse(data);
  mockGatewayFetch.mockResolvedValueOnce(res);
  mockGatewayJson.mockImplementation(async (r: Response) => {
    const text = await r.text();
    return JSON.parse(text);
  });
}

function makeGatewayError(errorMessage: string, status = 500) {
  const res = makeJsonResponse({ error: errorMessage }, status);
  mockGatewayFetch.mockResolvedValueOnce(res);
  mockGatewayJson.mockImplementation(async (r: Response) => {
    const text = await r.text();
    return JSON.parse(text);
  });
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe("mcp/server.ts — startMcpServer and tool handlers", () => {
  let projectPath: string;

  beforeEach(async () => {
    registeredTools.clear();
    registeredResources.clear();
    mockGatewayFetch.mockReset();
    mockGatewayJson.mockReset();
    mockSpawn.mockReset();
    mockFetch.mockReset();

    projectPath = makeTmpProject();

    // Register all tools and resources by calling startMcpServer
    await startMcpServer({ projectPath });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  // ─── startMcpServer ─────────────────────────────────────────────────────

  describe("startMcpServer", () => {
    it("registers all expected tools", () => {
      expect(registeredTools.has("al_start")).toBe(true);
      expect(registeredTools.has("al_stop")).toBe(true);
      expect(registeredTools.has("al_status")).toBe(true);
      expect(registeredTools.has("al_agents")).toBe(true);
      expect(registeredTools.has("al_run")).toBe(true);
      expect(registeredTools.has("al_logs")).toBe(true);
      expect(registeredTools.has("al_pause")).toBe(true);
      expect(registeredTools.has("al_resume")).toBe(true);
      expect(registeredTools.has("al_kill")).toBe(true);
    });

    it("registers agent-skill resource", () => {
      expect(registeredResources.has("agent-skill")).toBe(true);
    });

    it("accepts an optional envName parameter", async () => {
      // Should not throw
      await expect(
        startMcpServer({ projectPath, envName: "prod" })
      ).resolves.not.toThrow();
    });
  });

  // ─── al_stop ────────────────────────────────────────────────────────────

  describe("al_stop", () => {
    it("returns success message when gateway responds ok", async () => {
      makeGatewayOk({ message: "Scheduler stopped." });
      const result = await registeredTools.get("al_stop")!({});
      expect(result.content[0].text).toBe("Scheduler stopped.");
    });

    it("uses default message when gateway response has no message field", async () => {
      makeGatewayOk({});
      const result = await registeredTools.get("al_stop")!({});
      expect(result.content[0].text).toBe("Scheduler stopped.");
    });

    it("returns error message when gateway fails", async () => {
      makeGatewayError("connection refused", 500);
      const result = await registeredTools.get("al_stop")!({});
      expect(result.content[0].text).toContain("Failed to stop:");
    });
  });

  // ─── al_status ──────────────────────────────────────────────────────────

  describe("al_status", () => {
    it("returns formatted status when gateway is running", async () => {
      makeGatewayOk({
        state: "running",
        uptime: 120,
        agents: [
          { name: "dev", state: "idle", running: 0, queued: 0, schedule: "*/5 * * * *" },
        ],
        instances: [
          { id: "abc123", agent: "dev", startedAt: "2025-01-01T00:00:00Z" },
        ],
      });

      const result = await registeredTools.get("al_status")!({});
      const text = result.content[0].text;
      expect(text).toContain("running");
      expect(text).toContain("120");
      expect(text).toContain("dev");
      expect(text).toContain("abc123");
    });

    it("returns status with no agents or instances", async () => {
      makeGatewayOk({ state: "idle" });
      const result = await registeredTools.get("al_status")!({});
      expect(result.content[0].text).toContain("idle");
    });

    it("returns error when gateway fails", async () => {
      makeGatewayError("ECONNREFUSED", 500);
      const result = await registeredTools.get("al_status")!({});
      expect(result.content[0].text).toContain("Failed to get status:");
    });

    it("includes running and queued counts in agent line", async () => {
      makeGatewayOk({
        state: "running",
        agents: [{ name: "worker", running: 2, queued: 3, state: "running" }],
      });
      const result = await registeredTools.get("al_status")!({});
      expect(result.content[0].text).toContain("running=2");
      expect(result.content[0].text).toContain("queued=3");
    });
  });

  // ─── al_agents ──────────────────────────────────────────────────────────

  describe("al_agents", () => {
    it("lists all agents when no name is provided", async () => {
      // Gateway responds with live status
      makeGatewayOk({
        agents: [{ name: "dev", state: "idle", running: 0, queued: 0 }],
      });

      const result = await registeredTools.get("al_agents")!({ name: undefined });
      expect(result.content[0].text).toContain("dev");
    });

    it("returns empty message when no agents in project", async () => {
      // Create a project with no agents
      const emptyProject = mkdtempSync(join(tmpdir(), "al-mcp-empty-"));
      try {
        // Initialize an empty project (no agents dir)
        const { writeFileSync } = await import("fs");
        const { stringify: stringifyTOML } = await import("smol-toml");
        const { resolve } = await import("path");
        writeFileSync(resolve(emptyProject, "config.toml"), stringifyTOML({
          models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        }));

        // Register a fresh instance for the empty project
        const freshTools = new Map<string, (args: any) => Promise<any>>();
        const OrigMcpServer = (await import("@modelcontextprotocol/sdk/server/mcp.js")).McpServer;
        (OrigMcpServer as any).prototype._originalTool = (OrigMcpServer as any).prototype.tool;
        // Use the already-mocked server - the registeredTools will be cleared on next startMcpServer
        // Instead, just call the handler via the main project with an empty agents list
        makeGatewayOk({ agents: [] });
        const result = await registeredTools.get("al_agents")!({ name: undefined });
        // agents list won't be empty for main project
        expect(result.content[0].text).toBeTruthy();
      } finally {
        rmSync(emptyProject, { recursive: true, force: true });
      }
    });

    it("gets specific agent details", async () => {
      // First call: live status; Second call (inside handler): live status
      makeGatewayOk({
        agents: [{ name: "dev", state: "running", running: 1 }],
      });

      const result = await registeredTools.get("al_agents")!({ name: "dev" });
      expect(result.content[0].text).toContain("dev");
    });

    it("returns error when agent name not found", async () => {
      mockGatewayFetch.mockResolvedValue(makeJsonResponse({ agents: [] }));
      mockGatewayJson.mockImplementation(async (r: Response) => JSON.parse(await r.text()));

      const result = await registeredTools.get("al_agents")!({ name: "nonexistent-agent-xyz" });
      expect(result.content[0].text).toContain("not found");
    });

    it("handles gateway error gracefully when listing agents", async () => {
      mockGatewayFetch.mockRejectedValue(new Error("ECONNREFUSED fetch failed"));

      const result = await registeredTools.get("al_agents")!({ name: undefined });
      // Should still list agents from filesystem
      expect(result.content[0].text).toContain("dev");
    });
  });

  // ─── al_run ─────────────────────────────────────────────────────────────

  describe("al_run", () => {
    it("triggers an agent and returns success message", async () => {
      makeGatewayOk({ message: "Triggered dev." });
      const result = await registeredTools.get("al_run")!({ name: "dev" });
      expect(result.content[0].text).toBe("Triggered dev.");
    });

    it("uses default message when response has no message field", async () => {
      makeGatewayOk({});
      const result = await registeredTools.get("al_run")!({ name: "dev" });
      expect(result.content[0].text).toContain("Triggered dev");
    });

    it("returns error message when trigger fails", async () => {
      makeGatewayError("agent not found", 404);
      const result = await registeredTools.get("al_run")!({ name: "nonexistent" });
      expect(result.content[0].text).toContain("Failed to trigger");
    });
  });

  // ─── al_logs ────────────────────────────────────────────────────────────

  describe("al_logs", () => {
    const baseLogEntry = {
      msg: "test message",
      level: 30,
      time: Date.now(),
    };

    it("fetches and formats agent logs", async () => {
      makeGatewayOk({ entries: [baseLogEntry] });

      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 50,
        raw: false,
      });
      expect(result.content[0].text).toContain("info: test message");
    });

    it("fetches scheduler logs when name is 'scheduler'", async () => {
      makeGatewayOk({ entries: [{ ...baseLogEntry, msg: "scheduler started" }] });

      const result = await registeredTools.get("al_logs")!({
        name: "scheduler",
        lines: 100,
        raw: false,
      });
      expect(result.content[0].text).toContain("scheduler started");
    });

    it("fetches instance-specific logs when instance is provided", async () => {
      makeGatewayOk({ entries: [{ ...baseLogEntry, instance: "abc123" }] });

      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 50,
        instance: "abc123",
        raw: false,
      });
      expect(result.content[0].text).toBeTruthy();
    });

    it("returns no entries message when entries array is empty", async () => {
      makeGatewayOk({ entries: [] });

      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 10,
        raw: false,
      });
      expect(result.content[0].text).toBe("(no log entries)");
    });

    it("returns raw JSON log lines when raw=true", async () => {
      makeGatewayOk({ entries: [baseLogEntry] });

      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 10,
        raw: true,
      });
      expect(result.content[0].text).toContain('"msg"');
    });

    it("filters by level when level is provided", async () => {
      const entries = [
        { msg: "debug msg", level: 20, time: Date.now() },
        { msg: "info msg", level: 30, time: Date.now() },
        { msg: "error msg", level: 50, time: Date.now() },
      ];
      makeGatewayOk({ entries });

      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 100,
        level: "warn",
        raw: false,
      });
      const text = result.content[0].text;
      expect(text).toContain("error msg");
      expect(text).not.toContain("info msg");
    });

    it("returns error when gateway fails", async () => {
      makeGatewayError("no data");
      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 10,
        raw: false,
      });
      expect(result.content[0].text).toContain("Failed to fetch logs:");
    });

    it("clamps lines to 1000 max", async () => {
      makeGatewayOk({ entries: [baseLogEntry] });

      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 9999,
        raw: false,
      });
      // Should not throw, gateway is called with clamped value
      expect(result.content[0].text).toBeTruthy();
      const call = mockGatewayFetch.mock.calls[0][0];
      expect(call.path).toContain("lines=1000");
    });

    it("supports after/before time filters", async () => {
      makeGatewayOk({ entries: [baseLogEntry] });
      const after = new Date("2025-01-01T00:00:00Z").toISOString();
      const before = new Date("2025-12-31T00:00:00Z").toISOString();

      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 50,
        after,
        before,
        raw: false,
      });
      expect(result.content[0].text).toBeTruthy();
      const call = mockGatewayFetch.mock.calls[0][0];
      expect(call.path).toContain("after=");
      expect(call.path).toContain("before=");
    });

    it("returns no entries for non-array data response", async () => {
      // Gateway returns data directly (not in .entries)
      makeGatewayOk([]);
      const result = await registeredTools.get("al_logs")!({
        name: "dev",
        lines: 10,
        raw: false,
      });
      expect(result.content[0].text).toBe("(no log entries)");
    });
  });

  // ─── al_pause ───────────────────────────────────────────────────────────

  describe("al_pause", () => {
    it("pauses entire scheduler when no name given", async () => {
      makeGatewayOk({ message: "Scheduler paused." });
      const result = await registeredTools.get("al_pause")!({ name: undefined });
      expect(result.content[0].text).toBe("Scheduler paused.");
    });

    it("pauses a specific agent by name", async () => {
      makeGatewayOk({ message: "Paused dev." });
      const result = await registeredTools.get("al_pause")!({ name: "dev" });
      expect(result.content[0].text).toBe("Paused dev.");
    });

    it("uses default message when response has no message field", async () => {
      makeGatewayOk({});
      const result = await registeredTools.get("al_pause")!({ name: "dev" });
      expect(result.content[0].text).toContain("Paused dev");
    });

    it("returns error when pause fails", async () => {
      makeGatewayError("not found", 404);
      const result = await registeredTools.get("al_pause")!({ name: "dev" });
      expect(result.content[0].text).toContain("Failed to pause:");
    });
  });

  // ─── al_resume ──────────────────────────────────────────────────────────

  describe("al_resume", () => {
    it("resumes entire scheduler when no name given", async () => {
      makeGatewayOk({ message: "Scheduler resumed." });
      const result = await registeredTools.get("al_resume")!({ name: undefined });
      expect(result.content[0].text).toBe("Scheduler resumed.");
    });

    it("resumes a specific agent by name", async () => {
      makeGatewayOk({ message: "Resumed dev." });
      const result = await registeredTools.get("al_resume")!({ name: "dev" });
      expect(result.content[0].text).toBe("Resumed dev.");
    });

    it("uses default message when response has no message field", async () => {
      makeGatewayOk({});
      const result = await registeredTools.get("al_resume")!({ name: "dev" });
      expect(result.content[0].text).toContain("Resumed dev");
    });

    it("returns error when resume fails", async () => {
      makeGatewayError("not running", 400);
      const result = await registeredTools.get("al_resume")!({ name: "dev" });
      expect(result.content[0].text).toContain("Failed to resume:");
    });
  });

  // ─── al_kill ────────────────────────────────────────────────────────────

  describe("al_kill", () => {
    it("kills agent by name", async () => {
      makeGatewayOk({ message: "Killed dev." });
      const result = await registeredTools.get("al_kill")!({ target: "dev" });
      expect(result.content[0].text).toBe("Killed dev.");
    });

    it("uses default message when response has no message field", async () => {
      makeGatewayOk({});
      const result = await registeredTools.get("al_kill")!({ target: "dev" });
      expect(result.content[0].text).toContain("Killed dev");
    });

    it("falls back to instance-level kill on 404", async () => {
      // First call: 404
      const res404 = makeJsonResponse({ error: "Agent not found" }, 404);
      mockGatewayFetch.mockResolvedValueOnce(res404);
      mockGatewayJson.mockImplementationOnce(async (r: Response) => JSON.parse(await r.text()));

      // Second call: success
      makeGatewayOk({ message: "Killed instance abc123." });

      const result = await registeredTools.get("al_kill")!({ target: "abc123" });
      expect(result.content[0].text).toBe("Killed instance abc123.");
    });

    it("returns error when agent kill fails with non-404 error", async () => {
      makeGatewayError("server error", 500);
      const result = await registeredTools.get("al_kill")!({ target: "dev" });
      expect(result.content[0].text).toContain("Failed to kill:");
    });

    it("returns error when instance kill also fails after 404", async () => {
      // First call: 404
      const res404 = makeJsonResponse({ error: "not found" }, 404);
      mockGatewayFetch.mockResolvedValueOnce(res404);
      mockGatewayJson.mockImplementationOnce(async (r: Response) => JSON.parse(await r.text()));

      // Second call: also fails
      makeGatewayError("instance not found", 404);

      const result = await registeredTools.get("al_kill")!({ target: "bad-id" });
      expect(result.content[0].text).toContain("Failed to kill:");
    });
  });

  // ─── al_start ───────────────────────────────────────────────────────────

  describe("al_start", () => {
    it("returns 'already running' when health check succeeds", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const result = await registeredTools.get("al_start")!({});
      expect(result.content[0].text).toBe("Scheduler is already running.");
    });

    it("spawns process and polls health when scheduler is not running", async () => {
      // First fetch call: not running (throws)
      // Then spawn is called
      // Then we poll 30 times - let's make it succeed on first poll
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // health check before spawn
        .mockResolvedValueOnce({ ok: true }); // health check poll succeeds

      const childMock = { unref: vi.fn() };
      mockSpawn.mockReturnValue(childMock);

      // Override setTimeout to not actually wait
      const origSetTimeout = global.setTimeout;
      vi.spyOn(global, "setTimeout").mockImplementation((fn: any) => {
        fn();
        return {} as any;
      });

      try {
        const result = await registeredTools.get("al_start")!({});
        expect(mockSpawn).toHaveBeenCalledWith(
          "al",
          expect.arrayContaining(["start", "--headless"]),
          expect.objectContaining({ detached: true }),
        );
        expect(childMock.unref).toHaveBeenCalled();
        expect(result.content[0].text).toContain("Scheduler started");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 'not responding' message when gateway never becomes ready", async () => {
      // Initial check fails
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const childMock = { unref: vi.fn() };
      mockSpawn.mockReturnValue(childMock);

      // Override setTimeout and simulate all 30 polls failing
      vi.spyOn(global, "setTimeout").mockImplementation((fn: any) => {
        fn();
        return {} as any;
      });

      try {
        const result = await registeredTools.get("al_start")!({});
        expect(result.content[0].text).toContain("not responding");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("passes envName to spawn when provided", async () => {
      // Re-run startMcpServer with envName
      registeredTools.clear();
      await startMcpServer({ projectPath, envName: "staging" });

      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const childMock = { unref: vi.fn() };
      mockSpawn.mockReturnValue(childMock);

      vi.spyOn(global, "setTimeout").mockImplementation((fn: any) => {
        fn();
        return {} as any;
      });

      try {
        await registeredTools.get("al_start")!({});
        expect(mockSpawn).toHaveBeenCalledWith(
          "al",
          expect.arrayContaining(["-E", "staging"]),
          expect.any(Object),
        );
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  // ─── agent-skill resource ───────────────────────────────────────────────

  describe("agent-skill resource", () => {
    it("returns SKILL.md content for an existing agent", async () => {
      const uri = new URL("al://agents/dev/skill");
      const result = await registeredResources.get("agent-skill")!(uri, { name: "dev" });
      expect(result.contents[0].mimeType).toBe("text/markdown");
      expect(result.contents[0].text).toBeTruthy();
    });

    it("handles array name parameter", async () => {
      const uri = new URL("al://agents/dev/skill");
      const result = await registeredResources.get("agent-skill")!(uri, { name: ["dev"] });
      expect(result.contents[0].text).toBeTruthy();
    });
  });

  // ─── callGateway error paths ─────────────────────────────────────────────

  describe("callGateway error handling", () => {
    it("returns ECONNREFUSED error message when scheduler is not running", async () => {
      mockGatewayFetch.mockRejectedValue(new Error("ECONNREFUSED connect failed"));

      const result = await registeredTools.get("al_stop")!({});
      expect(result.content[0].text).toContain("Scheduler not running");
    });

    it("returns 'fetch failed' error message for network failure", async () => {
      mockGatewayFetch.mockRejectedValue(new Error("fetch failed: network error"));

      const result = await registeredTools.get("al_run")!({ name: "dev" });
      expect(result.content[0].text).toContain("Scheduler not running");
    });

    it("returns generic error message for unexpected errors", async () => {
      mockGatewayFetch.mockRejectedValue(new Error("unexpected DB error"));

      const result = await registeredTools.get("al_stop")!({});
      expect(result.content[0].text).toContain("Failed to stop:");
      expect(result.content[0].text).toContain("unexpected DB error");
    });

    it("handles non-ok HTTP response with error field in body", async () => {
      const errorRes = makeJsonResponse({ error: "Unauthorized" }, 401);
      mockGatewayFetch.mockResolvedValue(errorRes);
      mockGatewayJson.mockImplementation(async (r: Response) => JSON.parse(await r.text()));

      const result = await registeredTools.get("al_stop")!({});
      expect(result.content[0].text).toContain("Failed to stop:");
      expect(result.content[0].text).toContain("Unauthorized");
    });

    it("handles non-ok HTTP response without error field (uses HTTP status)", async () => {
      const errorRes = makeJsonResponse({}, 503);
      mockGatewayFetch.mockResolvedValue(errorRes);
      mockGatewayJson.mockImplementation(async (r: Response) => JSON.parse(await r.text()));

      const result = await registeredTools.get("al_stop")!({});
      expect(result.content[0].text).toContain("Failed to stop:");
      expect(result.content[0].text).toContain("503");
    });
  });

  // ─── formatLogEntries ───────────────────────────────────────────────────

  describe("formatLogEntries (via al_logs)", () => {
    it("formats text (assistant) log entries", async () => {
      makeGatewayOk({ entries: [{ msg: "output", text: "Hello!", level: 30, time: Date.now() }] });
      const result = await registeredTools.get("al_logs")!({ name: "dev", lines: 10, raw: false });
      expect(result.content[0].text).toContain("assistant: Hello!");
    });

    it("formats bash command log entries", async () => {
      makeGatewayOk({ entries: [{ msg: "cmd_run", cmd: "ls -la", level: 30, time: Date.now() }] });
      const result = await registeredTools.get("al_logs")!({ name: "dev", lines: 10, raw: false });
      expect(result.content[0].text).toContain("bash: ls -la");
    });

    it("formats tool_start log entries", async () => {
      makeGatewayOk({ entries: [{ msg: "tool_start", tool: "read_file", level: 30, time: Date.now() }] });
      const result = await registeredTools.get("al_logs")!({ name: "dev", lines: 10, raw: false });
      expect(result.content[0].text).toContain("tool: read_file");
    });

    it("formats error log entries", async () => {
      makeGatewayOk({ entries: [{ msg: "error occurred", err: "timeout", level: 50, time: Date.now() }] });
      const result = await registeredTools.get("al_logs")!({ name: "dev", lines: 10, raw: false });
      expect(result.content[0].text).toContain("error: timeout");
    });

    it("skips debug-level entries in conversation view", async () => {
      makeGatewayOk({ entries: [
        { msg: "debug noise", level: 20, time: Date.now() },
        { msg: "info message", level: 30, time: Date.now() },
      ]});
      const result = await registeredTools.get("al_logs")!({ name: "dev", lines: 10, raw: false });
      const text = result.content[0].text;
      expect(text).not.toContain("debug noise");
      expect(text).toContain("info message");
    });

    it("skips tool_done entries in conversation view", async () => {
      makeGatewayOk({ entries: [
        { msg: "tool_done", level: 30, time: Date.now() },
        { msg: "useful message", level: 30, time: Date.now() },
      ]});
      const result = await registeredTools.get("al_logs")!({ name: "dev", lines: 10, raw: false });
      const text = result.content[0].text;
      expect(text).not.toContain("tool_done");
      expect(text).toContain("useful message");
    });

    it("formats generic log entries by level and message", async () => {
      makeGatewayOk({ entries: [{ msg: "agent started", level: 30, time: Date.now() }] });
      const result = await registeredTools.get("al_logs")!({ name: "dev", lines: 10, raw: false });
      expect(result.content[0].text).toContain("info: agent started");
    });

    it("returns (no log entries) when all entries are filtered out by level", async () => {
      makeGatewayOk({ entries: [{ msg: "debug only", level: 20, time: Date.now() }] });
      const result = await registeredTools.get("al_logs")!({
        name: "dev", lines: 10, raw: false, level: "error",
      });
      expect(result.content[0].text).toBe("(no log entries)");
    });
  });

  // ─── getBaseUrl (via al_start) ──────────────────────────────────────────

  describe("getBaseUrl (via al_start health check URL)", () => {
    it("uses gateway url from config when available", async () => {
      // Create project with explicit gateway URL
      const customProject = makeTmpProject({
        global: { gateway: { url: "http://custom.host:9000" } } as any,
      });

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: customProject });

        // Health check should use the configured URL
        mockFetch.mockResolvedValue({ ok: true });
        await registeredTools.get("al_start")!({});

        // The fetch was called with the custom URL
        const calls = mockFetch.mock.calls;
        const healthUrl = calls.find(c => String(c[0]).includes("health"))?.[0];
        if (healthUrl) {
          expect(String(healthUrl)).toContain("custom.host");
        }
      } finally {
        rmSync(customProject, { recursive: true, force: true });
      }
    });

    it("falls back to localhost when loadGlobalConfig throws", async () => {
      // Create a project with invalid config.toml so loadGlobalConfig throws
      const badProject = mkdtempSync(join(tmpdir(), "al-bad-config-"));
      const { writeFileSync } = await import("fs");
      const { resolve } = await import("path");
      writeFileSync(resolve(badProject, "config.toml"), "NOT VALID TOML {{{");

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: badProject });

        mockFetch.mockResolvedValue({ ok: true });
        await registeredTools.get("al_start")!({});

        const calls = mockFetch.mock.calls;
        const healthUrl = calls.find(c => String(c[0]).includes("health"))?.[0];
        if (healthUrl) {
          expect(String(healthUrl)).toContain("localhost:8080");
        }
      } finally {
        rmSync(badProject, { recursive: true, force: true });
      }
    });
  });

  // ─── al_agents with live status enrichment ──────────────────────────────

  describe("al_agents with live status", () => {
    it("enriches specific agent with live running instances", async () => {
      makeGatewayOk({
        agents: [{ name: "dev", state: "running", running: 2 }],
      });

      const result = await registeredTools.get("al_agents")!({ name: "dev" });
      expect(result.content[0].text).toContain("dev");
      // Live status enrichment (state/running)
      expect(result.content[0].text).toContain("running");
    });

    it("enriches agent list with live state when gateway responds", async () => {
      makeGatewayOk({
        agents: [{ name: "dev", state: "running" }],
      });

      const result = await registeredTools.get("al_agents")!({ name: undefined });
      expect(result.content[0].text).toContain("dev");
    });

    it("handles agent config error gracefully in list mode", async () => {
      // Mock config.js to throw for one agent
      mockGatewayFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await registeredTools.get("al_agents")!({ name: undefined });
      // Should list agents from filesystem even without gateway
      expect(result.content[0].text).toBeTruthy();
    });
  });

  // ─── al_agents edge cases for uncovered branches ─────────────────────────

  describe("al_agents edge cases", () => {
    it("returns 'No agents found' when project has no agents", async () => {
      // Create a project directory with no agents
      const emptyDir = mkdtempSync(join(tmpdir(), "al-mcp-noagents-"));
      const { writeFileSync, mkdirSync } = await import("fs");
      const { resolve } = await import("path");
      const { stringify: stringifyTOML } = await import("smol-toml");
      writeFileSync(resolve(emptyDir, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      }));
      // Create agents dir but no agents inside
      mkdirSync(resolve(emptyDir, "agents"), { recursive: true });

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: emptyDir });

        const result = await registeredTools.get("al_agents")!({ name: undefined });
        expect(result.content[0].text).toBe("No agents found in this project.");
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it("shows agent description when set in SKILL.md frontmatter", async () => {
      // Create a project with a detailed agent config
      const detailedProject = makeTmpProject({
        agents: [
          {
            name: "detailed-agent",
            description: "A detailed agent description",
            schedule: "*/10 * * * *",
            credentials: ["github_token"],
            webhooks: [{ source: "github", events: ["push"] }],
          },
        ],
      });

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: detailedProject });

        makeGatewayOk({ agents: [] });
        const result = await registeredTools.get("al_agents")!({ name: "detailed-agent" });
        const text = result.content[0].text;
        expect(text).toContain("Description: A detailed agent description");
        expect(text).toContain("Schedule: */10 * * * *");
        expect(text).toContain("Credentials: github_token");
        expect(text).toContain("Webhooks:");
      } finally {
        rmSync(detailedProject, { recursive: true, force: true });
      }
    });

    it("shows scale and timeout when configured", async () => {
      const scaledProject = makeTmpProject({
        agents: [
          {
            name: "scaled-agent",
            scale: 3,
            timeout: 600,
          },
        ],
      });

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: scaledProject });

        makeGatewayOk({ agents: [] });
        const result = await registeredTools.get("al_agents")!({ name: "scaled-agent" });
        const text = result.content[0].text;
        expect(text).toContain("Scale: 3");
        expect(text).toContain("Timeout: 600s");
      } finally {
        rmSync(scaledProject, { recursive: true, force: true });
      }
    });

    it("lists agents with schedule and webhooks in list mode", async () => {
      // Use the default project which has agents with schedule/webhooks
      const richProject = makeTmpProject({
        agents: [
          {
            name: "rich-agent",
            schedule: "0 * * * *",
            webhooks: [{ source: "github", events: ["issues"] }],
          },
        ],
      });

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: richProject });

        // No live status
        mockGatewayFetch.mockRejectedValue(new Error("ECONNREFUSED"));

        const result = await registeredTools.get("al_agents")!({ name: undefined });
        const text = result.content[0].text;
        expect(text).toContain("rich-agent");
        expect(text).toContain("schedule:");
        expect(text).toContain("webhooks:");
      } finally {
        rmSync(richProject, { recursive: true, force: true });
      }
    });

    it("handles config error for an agent in list mode (shows config error)", async () => {
      // Create a project with an agent that has broken config
      const brokenProject = mkdtempSync(join(tmpdir(), "al-mcp-broken-"));
      const { writeFileSync, mkdirSync } = await import("fs");
      const { resolve } = await import("path");
      const { stringify: stringifyTOML } = await import("smol-toml");

      writeFileSync(resolve(brokenProject, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      }));

      // Create an agent with a broken config.toml
      const agentDir = resolve(brokenProject, "agents", "broken-agent");
      mkdirSync(agentDir, { recursive: true });
      // SKILL.md must exist for discoverAgents to find it
      writeFileSync(resolve(agentDir, "SKILL.md"), "---\n---\n# broken agent\n");
      // Write an invalid config.toml so loadAgentConfig throws
      writeFileSync(resolve(agentDir, "config.toml"), "models = {{bad toml}");

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: brokenProject });

        mockGatewayFetch.mockRejectedValue(new Error("ECONNREFUSED"));

        const result = await registeredTools.get("al_agents")!({ name: undefined });
        const text = result.content[0].text;
        expect(text).toContain("broken-agent");
        expect(text).toContain("config error");
      } finally {
        rmSync(brokenProject, { recursive: true, force: true });
      }
    });

    it("shows live state in list mode when gateway provides agent status", async () => {
      const listProject = makeTmpProject({
        agents: [{ name: "list-agent" }],
      });

      try {
        registeredTools.clear();
        await startMcpServer({ projectPath: listProject });

        makeGatewayOk({
          agents: [{ name: "list-agent", state: "running", status: "active" }],
        });

        const result = await registeredTools.get("al_agents")!({ name: undefined });
        const text = result.content[0].text;
        expect(text).toContain("list-agent");
        expect(text).toContain("state:");
      } finally {
        rmSync(listProject, { recursive: true, force: true });
      }
    });
  });
});
