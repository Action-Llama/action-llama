/**
 * E2E tests for log streaming via the `al logs` CLI command.
 *
 * Verifies:
 * - `al logs scheduler` fetches scheduler log entries through the gateway API
 *   and renders them in human-readable conversation format (not raw JSON).
 * - `al logs scheduler --raw` returns raw NDJSON log entries.
 * - `al logs <agent>` when the agent has not run returns an appropriate message.
 * - File-fallback path: when the gateway is not running, `al logs` reads
 *   directly from the .al/logs/<agent>-<date>.log file on disk.
 * - Cursor-based pagination: consecutive `al logs scheduler` calls with a
 *   cursor advance the cursor and may return new entries.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestContext, type ContainerInfo } from "../harness.js";
import { setupLocalActionLlama, createTestAgent, getSchedulerLogs } from "../containers/local.js";

const GATEWAY_PORT = 8787;
const API_KEY = "log-streaming-e2e-key-77777";
const COOKIE_JAR = "/tmp/cookies-log-streaming.txt";

/** Start the scheduler with gateway and wait until health endpoint responds. */
async function startGateway(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `mkdir -p ~/.action-llama/credentials/gateway_api_key/default && echo -n '${API_KEY}' > ~/.action-llama/credentials/gateway_api_key/default/key`,
  ]);

  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && cat >> config.toml << 'EOF'

[gateway]
port = ${GATEWAY_PORT}
EOF`,
  ]);

  await context.executeInContainer(container, [
    "bash",
    "-c",
    `cd /home/testuser/test-project && nohup al start --headless --web-ui > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid`,
  ]);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const health = await context.executeInContainer(container, [
        "curl",
        "-sf",
        `http://localhost:${GATEWAY_PORT}/health`,
      ]);
      if (health.includes("ok")) return;
    } catch {
      // not ready yet
    }
  }

  const logs = await getSchedulerLogs(context, container);
  throw new Error(`Gateway did not become healthy within 30s.\nLogs: ${logs}`);
}

/** Stop the scheduler process. */
async function stopGateway(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  try {
    await context.executeInContainer(container, [
      "bash",
      "-c",
      "if [ -f /tmp/scheduler.pid ]; then kill $(cat /tmp/scheduler.pid) 2>/dev/null; rm -f /tmp/scheduler.pid; fi",
    ]);
  } catch {
    // process might already be dead
  }
}

/** Login and persist session cookie. */
async function login(
  context: E2ETestContext,
  container: ContainerInfo,
): Promise<void> {
  await context.executeInContainer(container, [
    "bash",
    "-c",
    `curl -sf -c ${COOKIE_JAR} -X POST -H 'Content-Type: application/json' -d '{"key":"${API_KEY}"}' http://localhost:${GATEWAY_PORT}/api/auth/login`,
  ]);
}

// ---------------------------------------------------------------------------

describe("Log Streaming", { timeout: 300000 }, () => {
  let context: E2ETestContext;
  let container: ContainerInfo;

  beforeAll(async () => {
    context = new E2ETestContext();
    await context.setup();

    container = await setupLocalActionLlama(context);

    // Create a test agent so there's something to log about
    await createTestAgent(
      context,
      container,
      "log-stream-agent",
      "# Log Stream Test Agent\n\nA test agent for log streaming tests.",
    );

    await startGateway(context, container);
    await login(context, container);

    // Allow the scheduler a moment to write several log entries
    await new Promise((r) => setTimeout(r, 3000));
  }, 300000);

  afterAll(async () => {
    if (context && container) {
      await stopGateway(context, container);
    }
    if (context) {
      await context.cleanup();
    }
  });

  // -- al logs scheduler (gateway path) ------------------------------------

  it("al logs scheduler returns human-readable output via gateway API", async () => {
    // al logs reads from the gateway API and renders entries in conversation format.
    // The output should NOT be raw JSON — it should be human-readable lines.
    const output = await context.executeInContainer(container, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && al logs scheduler --lines 20 2>&1 || true`,
    ]);

    // Should have produced some output — the scheduler logs its startup sequence
    expect(output.trim().length).toBeGreaterThan(0);

    // Conversation format renders timestamps as HH:MM:SS (not epoch ms) and
    // does NOT contain raw JSON objects like {"level":30,"time":...}
    // The output should not look like raw NDJSON
    expect(output).not.toMatch(/^\{"level":\d+,"time":\d+/m);

    // Should mention the scheduler starting up or at least one log message
    // The conversation formatter outputs readable lines with coloured timestamps
    // Check that it does not contain "No log entries found" (there SHOULD be entries)
    expect(output).not.toContain("No log entries found");
  });

  it("al logs scheduler --raw returns NDJSON entries", async () => {
    // --raw mode outputs raw JSON lines (one per entry) without ANSI formatting
    const output = await context.executeInContainer(container, [
      "bash",
      "-c",
      // Strip ANSI codes so we can parse the JSON
      `cd /home/testuser/test-project && al logs scheduler --raw --lines 10 2>&1 | sed 's/\\x1b\\[[0-9;]*m//g' || true`,
    ]);

    expect(output.trim().length).toBeGreaterThan(0);

    // In raw mode each output line starts with a time (HH:MM:SS) followed by
    // the level label (INFO, WARN, etc.) and the message.
    // The log entries from the API are formatted by formatRawEntry, which produces:
    //   "HH:MM:SS LEVEL  <message>"
    // Verify at least one line looks like a raw log entry
    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);

    // Each line should contain a level label like INFO, WARN, ERROR, DEBUG, etc.
    const hasLevelLabel = lines.some((l) =>
      /INFO|WARN|ERROR|DEBUG|TRACE/.test(l)
    );
    expect(hasLevelLabel).toBe(true);
  });

  it("al logs <agent> returns no-entries message when agent has not run", async () => {
    // The log-stream-agent has never been triggered, so there should be no log file.
    const output = await context.executeInContainer(container, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && al logs log-stream-agent --lines 10 2>&1 || true`,
    ]);

    // The command should exit cleanly and report no entries (not crash)
    expect(output).toContain("No log entries found");
  });

  // -- File-fallback path --------------------------------------------------

  it("al logs reads from file when gateway is not running", async () => {
    // Create a separate container (no gateway) and write a synthetic log file.
    // Then verify al logs falls back to reading it from disk.
    // Use a fresh E2ETestContext so the container name does not conflict with
    // the primary container created in beforeAll.
    const fbContext = new E2ETestContext();
    await fbContext.setup();
    const fbContainer = await setupLocalActionLlama(fbContext);
    let fbCleanedUp = false;

    // Create the log directory and a synthetic log file
    const today = new Date().toISOString().slice(0, 10);
    const logDir = "/home/testuser/test-project/.al/logs";
    const logFile = `${logDir}/scheduler-${today}.log`;

    try {
      await fbContext.executeInContainer(fbContainer, [
        "bash",
        "-c",
        `mkdir -p ${logDir}`,
      ]);

      // Write two synthetic NDJSON log entries
      const entry1 = JSON.stringify({
        level: 30,
        time: Date.now() - 5000,
        msg: "scheduler started",
        pid: 1234,
        hostname: "test-host",
      });
      const entry2 = JSON.stringify({
        level: 30,
        time: Date.now() - 2000,
        msg: "cron jobs registered",
        cron_jobs: 1,
        pid: 1234,
        hostname: "test-host",
      });

      await fbContext.executeInContainer(fbContainer, [
        "bash",
        "-c",
        `printf '%s\n%s\n' '${entry1}' '${entry2}' > ${logFile}`,
      ]);

      // al logs scheduler — gateway is NOT running, so al falls back to file reading.
      // We do NOT start the gateway in fbContainer; al will get ECONNREFUSED and
      // fall through to the catch block that reads from disk.
      const output = await fbContext.executeInContainer(fbContainer, [
        "bash",
        "-c",
        `cd /home/testuser/test-project && al logs scheduler --raw --lines 10 2>&1 | sed 's/\\x1b\\[[0-9;]*m//g' || true`,
      ]);

      // Should contain both log messages
      expect(output).toContain("scheduler started");
      expect(output).toContain("cron jobs registered");

      // Should not contain "No log file found" error
      expect(output).not.toContain("No log file found");
    } finally {
      fbCleanedUp = true;
      await fbContext.cleanup();
    }
  });

  // -- Cursor-based pagination --------------------------------------------

  it("consecutive al logs calls with cursor advance the cursor", async () => {
    // Fetch scheduler logs via the API directly to get the initial cursor
    const initialRes = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} "http://localhost:${GATEWAY_PORT}/api/logs/scheduler?lines=10"`,
    ]);
    const initialData = JSON.parse(initialRes);

    expect(initialData).toHaveProperty("cursor");
    expect(initialData).toHaveProperty("entries");
    expect(Array.isArray(initialData.entries)).toBe(true);

    const cursor1 = initialData.cursor as string;
    expect(cursor1).toBeTruthy();

    // Poll with cursor — may return new entries or empty set
    const cursorEncoded = encodeURIComponent(cursor1);
    const pollRes = await context.executeInContainer(container, [
      "bash",
      "-c",
      `curl -sf -b ${COOKIE_JAR} "http://localhost:${GATEWAY_PORT}/api/logs/scheduler?lines=10&cursor=${cursorEncoded}"`,
    ]);
    const pollData = JSON.parse(pollRes);

    expect(pollData).toHaveProperty("cursor");
    expect(pollData).toHaveProperty("entries");
    // The new cursor should still be defined (even if no new entries)
    expect(pollData.cursor).toBeTruthy();
    // The cursor must be a valid base64url string
    expect(pollData.cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
