/**
 * Integration tests: cli/commands/status.ts execute() extended coverage — no Docker required.
 *
 * Extends the existing status-command.test.ts by exercising branches that
 * require a live (mock) gateway response:
 *
 *   1. printAgentConfig() with webhooks — shows "Webhooks:" section and filter details
 *   2. printLocalSessions() — "Running Instances" table with headers
 *   3. printLocalSessions() — instance ID truncated when > 20 chars
 *   4. execute() with live schedulerInfo — shows "Scheduler:" section
 *   5. execute() with live schedulerInfo — shows paused=true as "PAUSED"
 *   6. execute() with disabled agent (enabled:false) — table row shows "PAUSED"
 *   7. execute() with instances — shows "Running Instances:" section
 *   8. execute() with instances — shows "No running instances." when schedulerInfo is set but no instances
 *   9. execute() with queueSizes > 0 — shows queue count in table
 *  10. execute() with active locks — shows "Active locks:" section
 *
 * These tests spin up a minimal Hono HTTP server to simulate the gateway.
 * The project's config.toml is configured to point at the test server's port.
 *
 * Covers:
 *   - cli/commands/status.ts: printAgentConfig() — webhooks section + filter display
 *   - cli/commands/status.ts: printLocalSessions() — headers + row display
 *   - cli/commands/status.ts: printLocalSessions() — sessionId > 20 chars truncated
 *   - cli/commands/status.ts: execute() with schedulerInfo — "Scheduler:" section rendered
 *   - cli/commands/status.ts: execute() with schedulerInfo.paused=true — "PAUSED"
 *   - cli/commands/status.ts: execute() with disabled agent — "PAUSED" in table
 *   - cli/commands/status.ts: execute() with instances — "Running Instances:" rendered
 *   - cli/commands/status.ts: execute() schedulerInfo + no instances → "No running instances."
 *   - cli/commands/status.ts: execute() with queueSizes — queue count in table
 *   - cli/commands/status.ts: execute() with locks — "Active locks:" section rendered
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer, type Server } from "http";
import { stringify as stringifyTOML } from "smol-toml";

const { execute: statusExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/status.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Capture console.log output during a callback. */
async function captureOutput(fn: () => Promise<void>): Promise<{ logs: string[]; errors: string[] }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => errors.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return { logs, errors };
}

/** Create a minimal valid project structure with a gateway port configured. */
function setupProjectWithPort(projectDir: string, gatewayPort: number): void {
  mkdirSync(projectDir, { recursive: true });

  const globalConfig = {
    gateway: { port: gatewayPort },
    models: {
      sonnet: {
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        authType: "api_key",
      },
    },
  };
  writeFileSync(join(projectDir, "config.toml"), stringifyTOML(globalConfig as any));
}

/** Add an agent to the project. */
function addAgent(
  projectDir: string,
  agentName: string,
  opts: {
    schedule?: string;
    webhooks?: Array<{ source: string; events?: string[]; repos?: string[] }>;
    scale?: number;
  } = {}
): void {
  const agentDir = join(projectDir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  writeFileSync(
    join(agentDir, "SKILL.md"),
    `---\n---\n\n# ${agentName}\nTest agent.\n`
  );

  const agentConfig: Record<string, unknown> = {
    models: ["sonnet"],
    credentials: [],
  };
  if (opts.schedule) agentConfig.schedule = opts.schedule;
  if (opts.webhooks?.length) agentConfig.webhooks = opts.webhooks;
  if (opts.scale !== undefined) agentConfig.scale = opts.scale;
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(agentConfig));
}

/** Start a minimal mock HTTP server that responds to /control/status and /locks/status. */
function startMockGateway(
  controlStatusBody: object,
  locksStatusBody: object = { locks: [] },
): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/control/status") {
        res.writeHead(200);
        res.end(JSON.stringify(controlStatusBody));
      } else if (req.url === "/locks/status") {
        res.writeHead(200);
        res.end(JSON.stringify(locksStatusBody));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe(
  "integration: cli/commands/status.ts execute() with mock gateway (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;
    let mockServer: { server: Server; port: number; close: () => Promise<void> } | null = null;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-status-ext-test-"));
    });

    afterEach(async () => {
      if (mockServer) {
        await mockServer.close();
        mockServer = null;
      }
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── printAgentConfig() with webhooks ──────────────────────────────────────

    it("--agent shows 'Webhooks:' section when agent has webhooks configured", async () => {
      // For this test we just need a local project with a webhook-configured agent.
      // The gateway doesn't need to be running (falls through gracefully).
      setupProjectWithPort(projectDir, 19999); // port that won't respond
      addAgent(projectDir, "wh-agent", {
        webhooks: [{ source: "github", events: ["issues"] }],
      });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir, agent: "wh-agent" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Webhooks:");
    });

    it("--agent shows webhook source name in Webhooks section", async () => {
      setupProjectWithPort(projectDir, 19998);
      addAgent(projectDir, "wh-agent2", {
        webhooks: [{ source: "github", events: ["pull_request"] }],
      });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir, agent: "wh-agent2" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("github");
    });

    it("--agent shows event filters in Webhooks section", async () => {
      setupProjectWithPort(projectDir, 19997);
      addAgent(projectDir, "wh-agent3", {
        webhooks: [{ source: "sentry", events: ["event_alert", "issue_alert"] }],
      });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir, agent: "wh-agent3" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("event_alert");
    });

    it("--agent shows repos filter in Webhooks section when present", async () => {
      setupProjectWithPort(projectDir, 19996);
      addAgent(projectDir, "wh-agent4", {
        webhooks: [{ source: "github", events: ["issues"], repos: ["myorg/myrepo"] }],
      });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir, agent: "wh-agent4" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("myorg/myrepo");
    });

    // ── Live gateway: scheduler info section ──────────────────────────────────

    it("shows 'Scheduler:' section when gateway returns schedulerInfo", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "a", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Scheduler:");
    });

    it("shows 'Status: Running' when scheduler is not paused", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "a", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Status:");
      expect(allOutput).toContain("Running");
    });

    it("shows 'Status: PAUSED' when scheduler is paused", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: true, mode: "docker", gatewayPort: null },
        instances: [],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "a", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("PAUSED");
    });

    it("shows 'Mode:' in Scheduler section", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: 9090 },
        instances: [],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "a", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Mode:");
      expect(allOutput).toContain("docker");
    });

    it("shows 'Gateway:' URL in Scheduler section when gatewayPort is set", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: 8080 },
        instances: [],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "a", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Gateway:");
      expect(allOutput).toContain("8080");
    });

    it("shows 'Runtime:' line when schedulerInfo.runtime is set", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", runtime: "local", gatewayPort: null },
        instances: [],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "a", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Runtime:");
      expect(allOutput).toContain("local");
    });

    // ── Live gateway: agent PAUSED display ────────────────────────────────────

    it("shows 'PAUSED' for an agent that is disabled (enabled: false)", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [],
        agents: [{ name: "paused-agent", enabled: false }],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "paused-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("PAUSED");
    });

    it("--agent with disabled status: shows 'Status: PAUSED' in detail view", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [],
        agents: [{ name: "detail-paused", enabled: false }],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "detail-paused", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir, agent: "detail-paused" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("PAUSED");
    });

    // ── Live gateway: printLocalSessions ─────────────────────────────────────

    it("shows 'Running Instances:' when gateway returns running instances", async () => {
      const now = new Date().toISOString();
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [
          {
            id: "short-instance-id",
            agentName: "run-agent",
            status: "running",
            trigger: "manual",
            startedAt: now,
          },
        ],
        agents: [{ name: "run-agent", enabled: true }],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "run-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Running Instances:");
    });

    it("printLocalSessions shows AGENT, SESSION ID, STATUS column headers", async () => {
      const now = new Date().toISOString();
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [
          {
            id: "inst-123",
            agentName: "col-agent",
            status: "running",
            trigger: "schedule",
            startedAt: now,
          },
        ],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "col-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("AGENT");
      expect(allOutput).toContain("SESSION ID");
      expect(allOutput).toContain("STATUS");
    });

    it("printLocalSessions shows agent name and instance ID in row", async () => {
      const now = new Date().toISOString();
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [
          {
            id: "abc-inst-001",
            agentName: "row-agent",
            status: "running",
            trigger: "webhook",
            startedAt: now,
          },
        ],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "row-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("row-agent");
      expect(allOutput).toContain("abc-inst-001");
    });

    it("printLocalSessions truncates instance ID > 20 chars with '...' prefix", async () => {
      const now = new Date().toISOString();
      const longId = "this-is-a-very-long-instance-id-exceeding-20-chars-abc123";
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [
          {
            id: longId,
            agentName: "trunc-agent",
            status: "running",
            trigger: "manual",
            startedAt: now,
          },
        ],
        agents: [],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "trunc-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      // Should show "..." prefix + last 17 chars of the long ID
      expect(allOutput).toContain("...");
      expect(allOutput).toContain(longId.slice(-17));
    });

    // ── Live gateway: "No running instances." message ─────────────────────────

    it("shows 'No running instances.' when schedulerInfo is set but no instances", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [],
        agents: [{ name: "idle-agent", enabled: true }],
        queueSizes: {},
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "idle-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("No running instances.");
    });

    // ── Live gateway: queue sizes ─────────────────────────────────────────────

    it("shows non-zero queue count in table when queueSizes is populated", async () => {
      mockServer = await startMockGateway({
        scheduler: { paused: false, mode: "docker", gatewayPort: null },
        instances: [],
        agents: [{ name: "queued-agent", enabled: true }],
        queueSizes: { "queued-agent": 5 },
      });
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "queued-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      // The queue column shows the numeric count
      expect(allOutput).toContain("5");
    });

    // ── Live gateway: active locks section ───────────────────────────────────

    it("shows 'Active locks:' when gateway returns non-empty locks", async () => {
      mockServer = await startMockGateway(
        {
          scheduler: { paused: false, mode: "docker", gatewayPort: null },
          instances: [],
          agents: [],
          queueSizes: {},
        },
        {
          locks: [
            {
              agentName: "locking-agent",
              resourceKey: "github://myorg/repo/issues/42",
              heldSince: Date.now() - 30_000,
            },
          ],
        }
      );
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "locking-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Active locks:");
    });

    it("shows lock resource key in active locks section", async () => {
      mockServer = await startMockGateway(
        {
          scheduler: { paused: false, mode: "docker", gatewayPort: null },
          instances: [],
          agents: [],
          queueSizes: {},
        },
        {
          locks: [
            {
              agentName: "lock-agent",
              resourceKey: "github://owner/repo/pull/99",
              heldSince: Date.now() - 60_000,
            },
          ],
        }
      );
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "lock-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("github://owner/repo/pull/99");
    });

    it("shows lock held-for duration in active locks section", async () => {
      mockServer = await startMockGateway(
        {
          scheduler: { paused: false, mode: "docker", gatewayPort: null },
          instances: [],
          agents: [],
          queueSizes: {},
        },
        {
          locks: [
            {
              agentName: "dur-agent",
              resourceKey: "github://foo/bar/issues/1",
              heldSince: Date.now() - 45_000, // 45 seconds ago
            },
          ],
        }
      );
      setupProjectWithPort(projectDir, mockServer.port);
      addAgent(projectDir, "dur-agent", { schedule: "0 */6 * * *" });

      const { logs } = await captureOutput(() =>
        statusExecute({ project: projectDir })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("held for");
    });
  }
);
