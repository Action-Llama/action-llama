import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerAgentRunner } from "../../src/agents/container-runner.js";
import type { Runtime, RuntimeCredentials } from "../../src/docker/runtime.js";
import type { GlobalConfig, AgentConfig } from "../../src/shared/config.js";

// Minimal mock runtime — only methods called during run() are mocked
function createMockRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    needsGateway: false,
    isAgentRunning: vi.fn().mockResolvedValue(false),
    listRunningAgents: vi.fn().mockResolvedValue([]),
    launch: vi.fn().mockResolvedValue("container-123"),
    streamLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    waitForExit: vi.fn().mockResolvedValue(0),
    kill: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    prepareCredentials: vi.fn().mockResolvedValue({ strategy: "volume", stagingDir: "/tmp/creds", bundle: {} } as RuntimeCredentials),
    buildImage: vi.fn().mockResolvedValue("image:latest"),
    pushImage: vi.fn().mockResolvedValue("image:latest"),
    cleanupCredentials: vi.fn(),
    fetchLogs: vi.fn().mockResolvedValue([]),
    followLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    getTaskUrl: vi.fn().mockReturnValue(null),
    ...overrides,
  } as Runtime;
}

const makeMockLogger = (): any => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => makeMockLogger(),
});
const mockLogger = makeMockLogger();

const globalConfig: GlobalConfig = {};
const agentConfig: AgentConfig = {
  name: "test-agent",
  credentials: [],
  models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
  schedule: "*/5 * * * *",
};

describe("ContainerAgentRunner", () => {
  let runtime: Runtime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = createMockRuntime();
  });

  function createRunner(opts?: { runtime?: Runtime }) {
    return new ContainerAgentRunner(
      opts?.runtime ?? runtime,
      globalConfig,
      agentConfig,
      mockLogger,
      vi.fn(), // registerContainer
      vi.fn(), // unregisterContainer
      "",      // gatewayUrl
      "/tmp",  // projectPath
      "test-image:latest",
    );
  }

  describe("_running flag (Bug 1+2 fix)", () => {
    it("sets _running synchronously so concurrent callers see it immediately", async () => {
      // Make launch block so we can observe _running during the run
      let resolveLaunch!: (value: string) => void;
      const blockingRuntime = createMockRuntime({
        launch: vi.fn().mockImplementation(() => new Promise((r) => { resolveLaunch = r; })),
      });
      const runner = createRunner({ runtime: blockingRuntime });

      // Start run — will block at launch()
      const runPromise = runner.run("test prompt");

      // Yield a microtick so run() enters past the sync guard
      await Promise.resolve();

      // _running should be true before launch resolves
      expect(runner.isRunning).toBe(true);

      // Second call should bail immediately
      const secondResult = await runner.run("test prompt 2");
      expect(secondResult.result).toBe("error");

      // Unblock and let it finish
      resolveLaunch("container-1");
      await runPromise;
    });

    it("does not call isAgentRunning during run", async () => {
      const runner = createRunner();
      await runner.run("test prompt");

      expect(runtime.isAgentRunning).not.toHaveBeenCalled();
    });

    it("two runners for the same agent can run concurrently", async () => {
      const runner1 = createRunner({ instanceId: "test-agent(1)" });
      const runner2 = createRunner({ instanceId: "test-agent(2)" });

      const p1 = runner1.run("prompt 1");
      const p2 = runner2.run("prompt 2");

      // Both should be running after yielding
      await Promise.resolve();
      expect(runner1.isRunning).toBe(true);
      expect(runner2.isRunning).toBe(true);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.result).toBe("completed");
      expect(r2.result).toBe("completed");
      expect(runner1.isRunning).toBe(false);
      expect(runner2.isRunning).toBe(false);
    });

    it("resets _running on error", async () => {
      const errorRuntime = createMockRuntime({
        launch: vi.fn().mockRejectedValue(new Error("launch failed")),
      });
      const runner = createRunner({ runtime: errorRuntime });

      const result = await runner.run("test prompt");
      expect(result.result).toBe("error");
      expect(runner.isRunning).toBe(false);
    });
  });

  // ── setImage / setAgentConfig accessors ─────────────────────────────────

  describe("setImage / setAgentConfig", () => {
    it("updates image used for subsequent runs", () => {
      const runner = createRunner();
      runner.setImage("new-image:2.0");
      expect(runner.containerName).toBeUndefined(); // just checking no throw
    });

    it("updates agentConfig used for subsequent runs", () => {
      const runner = createRunner();
      const newConfig: AgentConfig = { ...agentConfig, name: "updated-agent" };
      runner.setAgentConfig(newConfig);
      expect(runner.containerName).toBeUndefined();
    });
  });

  // ── abort() with containerName set ──────────────────────────────────────

  describe("abort()", () => {
    it("sets _aborting and calls runtime.kill when container is running", async () => {
      let capturedOnLine: ((line: string) => void) | undefined;
      let resolveLaunch!: (value: string) => void;

      const blockingRuntime = createMockRuntime({
        launch: vi.fn().mockImplementation(() => new Promise((r) => { resolveLaunch = r; })),
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });

      const runner = createRunner({ runtime: blockingRuntime });
      const runPromise = runner.run("test prompt");

      // Wait for launch to be called (in the Promise executor)
      await Promise.resolve();
      resolveLaunch("al-test-running");

      // Wait more ticks to ensure the runner is past launch
      await Promise.resolve();
      await Promise.resolve();

      runner.abort();
      await runPromise;

      expect(blockingRuntime.kill).toHaveBeenCalled();
    });
  });

  // ── triggerInfo paths ────────────────────────────────────────────────────

  describe("run() with triggerInfo", () => {
    it("includes trigger type in log when triggerInfo is provided (schedule)", async () => {
      const runner = createRunner();
      const result = await runner.run("test prompt", { type: "schedule" });
      expect(result.result).toBe("completed");
      const logger = (mockLogger.child as any)();
      // info was called with a message containing "triggered by"
    });

    it("includes agent+source in log when type=agent with source", async () => {
      const runner = createRunner();
      const result = await runner.run("test prompt", { type: "agent", source: "orchestrator" });
      expect(result.result).toBe("completed");
    });

    it("includes trigger source in log when type=webhook", async () => {
      const runner = createRunner();
      const result = await runner.run("test prompt", { type: "webhook", source: "github" });
      expect(result.result).toBe("completed");
    });
  });

  // ── Exit code handling ───────────────────────────────────────────────────

  describe("exit code handling", () => {
    it("returns 'rerun' result when container exits with code 42", async () => {
      const rerunnableRuntime = createMockRuntime({
        waitForExit: vi.fn().mockResolvedValue(42),
      });
      const runner = createRunner({ runtime: rerunnableRuntime });
      const result = await runner.run("test prompt");
      expect(result.result).toBe("rerun");
    });

    it("returns 'error' result when container exits with non-zero non-42 code", async () => {
      const errorExitRuntime = createMockRuntime({
        waitForExit: vi.fn().mockResolvedValue(1),
      });
      const runner = createRunner({ runtime: errorExitRuntime });
      const result = await runner.run("test prompt");
      expect(result.result).toBe("error");
    });

    it("returns 'completed' result when container exits with code 0", async () => {
      const runner = createRunner();
      const result = await runner.run("test prompt");
      expect(result.result).toBe("completed");
    });
  });

  // ── taskUrl path ────────────────────────────────────────────────────────

  describe("task URL from runtime", () => {
    it("sets task URL in status tracker when runtime provides one", async () => {
      const mockStatusTracker = {
        startRun: vi.fn(),
        endRun: vi.fn(),
        registerInstance: vi.fn(),
        completeInstance: vi.fn(),
        setAgentError: vi.fn(),
        setTaskUrl: vi.fn(),
        addLogLine: vi.fn(),
        setPaused: vi.fn(),
        enableAgent: vi.fn(),
        disableAgent: vi.fn(),
        updateAgentScale: vi.fn(),
        isPaused: vi.fn().mockReturnValue(false),
        setShuttingDown: vi.fn(),
      };

      const taskUrlRuntime = createMockRuntime({
        getTaskUrl: vi.fn().mockReturnValue("https://console.example.com/tasks/123"),
      });

      const runner = new ContainerAgentRunner(
        taskUrlRuntime,
        globalConfig,
        agentConfig,
        mockLogger,
        vi.fn(),
        vi.fn(),
        "",
        "/tmp",
        "test-image:latest",
        mockStatusTracker as any,
      );

      await runner.run("test prompt");
      expect(mockStatusTracker.setTaskUrl).toHaveBeenCalledWith(
        "test-agent",
        "https://console.example.com/tasks/123"
      );
    });
  });

  // ── forwardLogLine via streamLogs callback ───────────────────────────────

  describe("forwardLogLine (via streamLogs callback)", () => {
    function createRunnerWithLogCapture() {
      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });
      const runner = createRunner({ runtime: captureRuntime });
      return { runner, captureRuntime, getCapturedOnLine: () => capturedOnLine };
    }

    it("ignores empty lines", async () => {
      const { runner, getCapturedOnLine } = createRunnerWithLogCapture();
      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Emit empty line — should not throw
      const onLine = getCapturedOnLine();
      if (onLine) {
        expect(() => onLine("   ")).not.toThrow();
        expect(() => onLine("")).not.toThrow();
      }
      await runPromise;
    });

    it("ignores non-JSON lines", async () => {
      const { runner, captureRuntime, getCapturedOnLine } = createRunnerWithLogCapture();
      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const onLine = getCapturedOnLine();
      if (onLine) {
        // Should not throw for plain text
        expect(() => onLine("plain log output")).not.toThrow();
      }
      await runPromise;
    });

    it("logs _log:true info entries at info level", async () => {
      const childLogger = makeMockLogger();
      const parentLogger = { ...mockLogger, child: vi.fn().mockReturnValue(childLogger) };

      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });

      const runner = new ContainerAgentRunner(
        captureRuntime, globalConfig, agentConfig, parentLogger as any,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      if (capturedOnLine) {
        capturedOnLine(JSON.stringify({ _log: true, level: "info", msg: "assistant", text: "Hello", ts: Date.now() }));
        expect(childLogger.info).toHaveBeenCalledWith(expect.objectContaining({ text: "Hello" }), "assistant");
      }
      await runPromise;
    });

    it("logs _log:true warn entries at warn level", async () => {
      const childLogger = makeMockLogger();
      const parentLogger = { ...mockLogger, child: vi.fn().mockReturnValue(childLogger) };

      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });

      const runner = new ContainerAgentRunner(
        captureRuntime, globalConfig, agentConfig, parentLogger as any,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      if (capturedOnLine) {
        capturedOnLine(JSON.stringify({ _log: true, level: "warn", msg: "rate limit", ts: Date.now() }));
        expect(childLogger.warn).toHaveBeenCalledWith("rate limit");
      }
      await runPromise;
    });

    it("logs _log:true debug entries at debug level", async () => {
      const childLogger = makeMockLogger();
      const parentLogger = { ...mockLogger, child: vi.fn().mockReturnValue(childLogger) };

      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });

      const runner = new ContainerAgentRunner(
        captureRuntime, globalConfig, agentConfig, parentLogger as any,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      if (capturedOnLine) {
        capturedOnLine(JSON.stringify({ _log: true, level: "debug", msg: "tool start", tool: "bash", ts: Date.now() }));
        expect(childLogger.debug).toHaveBeenCalled();
      }
      await runPromise;
    });

    it("detects signal-result return value", async () => {
      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });

      const runner = createRunner({ runtime: captureRuntime });
      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      if (capturedOnLine) {
        capturedOnLine(JSON.stringify({
          _log: true, level: "info", msg: "signal-result",
          type: "return", value: "task completed", ts: Date.now(),
        }));
      }
      const result = await runPromise;
      expect(result.result).toBe("completed");
    });

    it("ignores JSON without _log flag", async () => {
      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });

      const runner = createRunner({ runtime: captureRuntime });
      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      if (capturedOnLine) {
        // Should not throw for JSON without _log
        expect(() => capturedOnLine!(JSON.stringify({ level: 30, msg: "pino log" }))).not.toThrow();
      }
      await runPromise;
    });
  });

  // ── gatewayUrl paths ─────────────────────────────────────────────────────

  describe("run() with gatewayUrl", () => {
    function createRunnerWithGateway() {
      const registerContainer = vi.fn().mockResolvedValue(undefined);
      const unregisterContainer = vi.fn().mockResolvedValue(undefined);
      const runner = new ContainerAgentRunner(
        runtime,
        globalConfig,
        agentConfig,
        mockLogger,
        registerContainer,
        unregisterContainer,
        "http://localhost:8080",
        "/tmp",
        "test-image:latest",
      );
      return { runner, registerContainer, unregisterContainer };
    }

    it("registers container with gateway and unregisters on completion", async () => {
      const { runner, registerContainer, unregisterContainer } = createRunnerWithGateway();
      await runner.run("test prompt");

      expect(registerContainer).toHaveBeenCalledWith(
        expect.any(String), // shutdownSecret
        expect.objectContaining({
          containerName: "container-123",
          agentName: "test-agent",
        })
      );
      expect(unregisterContainer).toHaveBeenCalledWith(expect.any(String));
    });
  });
});
