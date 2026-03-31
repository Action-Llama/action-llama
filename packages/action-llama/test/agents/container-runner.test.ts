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

    it("resets _running when withSpan setup fails before _runInternalContainer runs", async () => {
      const mockTelemetryModule = await import("../../src/telemetry/index.js");
      const spy = vi.spyOn(mockTelemetryModule, "withSpan")
        .mockRejectedValueOnce(new Error("span setup failed"));

      const runner = createRunner();
      const result = await runner.run("test prompt");

      expect(result.result).toBe("error");
      expect(runner.isRunning).toBe(false); // Must not be stuck as ghost runner

      spy.mockRestore();
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

  // ── abort() before any container is running ─────────────────────────────

  describe("abort() without an active container", () => {
    it("sets _aborting without throwing even when no container has been launched", () => {
      const runner = createRunner();
      // abort() before run() — _containerName is undefined
      expect(() => runner.abort()).not.toThrow();
      // runtime.kill should NOT be called since there's no container
      expect((runtime.kill as any).mock.calls).toHaveLength(0);
    });
  });

  // ── forwardLogLine: tool error surface ──────────────────────────────────

  describe("forwardLogLine — tool error surfacing", () => {
    function createRunnerWithLogCapture(extraOpts?: { statusTracker?: any }) {
      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });
      const mockStatusTracker = extraOpts?.statusTracker;
      const runner = new ContainerAgentRunner(
        captureRuntime, globalConfig, agentConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest", mockStatusTracker,
      );
      return { runner, captureRuntime, getCapturedOnLine: () => capturedOnLine };
    }

    function makeMockStatusTracker() {
      return {
        startRun: vi.fn(),
        endRun: vi.fn(),
        registerInstance: vi.fn(),
        unregisterInstance: vi.fn(),
        completeInstance: vi.fn(),
        addLogLine: vi.fn(),
        setAgentError: vi.fn(),
        setTaskUrl: vi.fn(),
        isAgentEnabled: vi.fn().mockReturnValue(true),
        isPaused: vi.fn().mockReturnValue(false),
      };
    }

    it("surfaces tool error with plain string result to status tracker", async () => {
      const mockStatusTracker = makeMockStatusTracker();
      const { runner, getCapturedOnLine } = createRunnerWithLogCapture({ statusTracker: mockStatusTracker });

      const runPromise = runner.run("test prompt");
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      const onLine = getCapturedOnLine();
      if (onLine) {
        onLine(JSON.stringify({
          _log: true, level: "error", msg: "tool error",
          result: "Command failed: bash",
          ts: Date.now(),
        }));
      }
      await runPromise;

      expect(mockStatusTracker.setAgentError).toHaveBeenCalledWith(
        "test-agent",
        expect.stringContaining("Command failed: bash"),
      );
    });

    it("extracts text from JSON-encoded tool error result (content[0].text)", async () => {
      const mockStatusTracker = makeMockStatusTracker();
      const { runner, getCapturedOnLine } = createRunnerWithLogCapture({ statusTracker: mockStatusTracker });

      const runPromise = runner.run("test prompt");
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      const innerResult = JSON.stringify({ content: [{ text: "Permission denied" }] });
      const onLine = getCapturedOnLine();
      if (onLine) {
        onLine(JSON.stringify({
          _log: true, level: "error", msg: "tool error",
          result: innerResult, cmd: "rm -rf /protected",
          ts: Date.now(),
        }));
      }
      await runPromise;

      expect(mockStatusTracker.setAgentError).toHaveBeenCalledWith(
        "test-agent",
        expect.stringContaining("Permission denied"),
      );
    });

    it("includes cmd prefix in tool error message when cmd is present", async () => {
      const mockStatusTracker = makeMockStatusTracker();
      const { runner, getCapturedOnLine } = createRunnerWithLogCapture({ statusTracker: mockStatusTracker });

      const runPromise = runner.run("test prompt");
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      const onLine = getCapturedOnLine();
      if (onLine) {
        onLine(JSON.stringify({
          _log: true, level: "error", msg: "tool error",
          result: "exit code 1", cmd: "npm test",
          ts: Date.now(),
        }));
      }
      await runPromise;

      expect(mockStatusTracker.setAgentError).toHaveBeenCalledWith(
        "test-agent",
        expect.stringContaining("$ npm test"),
      );
    });
  });

  // ── forwardLogLine: token-usage ──────────────────────────────────────────

  describe("forwardLogLine — token-usage and OTel attributes", () => {
    it("captures token usage from log line and includes it in the RunOutcome", async () => {
      let capturedOnLine: ((line: string) => void) | undefined;
      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });
      const runner = new ContainerAgentRunner(
        captureRuntime, globalConfig, agentConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const runPromise = runner.run("test prompt");
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      if (capturedOnLine) {
        capturedOnLine(JSON.stringify({
          _log: true, level: "info", msg: "token-usage",
          inputTokens: 500, outputTokens: 200, cacheReadTokens: 50,
          cacheWriteTokens: 10, totalTokens: 750, cost: 0.005, turnCount: 3,
          ts: Date.now(),
        }));
      }
      const result = await runPromise;

      expect(result.usage).toMatchObject({
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        totalTokens: 750,
        cost: 0.005,
        turnCount: 3,
      });
    });
  });

  // ── streamLogs stderr callback ───────────────────────────────────────────

  describe("streamLogs stderr callback", () => {
    it("logs container stderr output at warn level", async () => {
      let capturedStderr: ((text: string) => void) | undefined;
      const childLogger = makeMockLogger();
      const parentLogger = { ...mockLogger, child: vi.fn().mockReturnValue(childLogger) };

      const captureRuntime = createMockRuntime({
        streamLogs: vi.fn().mockImplementation(
          (_name: string, _onLine: (line: string) => void, onStderr: (text: string) => void) => {
            capturedStderr = onStderr;
            return { stop: vi.fn() };
          }
        ),
      });
      const runner = new ContainerAgentRunner(
        captureRuntime, globalConfig, agentConfig, parentLogger as any,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const runPromise = runner.run("test prompt");
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      if (capturedStderr) {
        capturedStderr("Error: something went wrong on stderr");
      }
      await runPromise;

      expect(childLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ stderr: expect.stringContaining("something went wrong") }),
        "container stderr",
      );
    });
  });

  // ── _aborting + non-zero exit code ───────────────────────────────────────

  describe("run() with abort while container is running (exit code 1)", () => {
    it("logs 'container killed (abort requested)' when _aborting is true and exit is non-zero", async () => {
      let capturedOnLine: ((line: string) => void) | undefined;
      let resolveLaunch!: (value: string) => void;
      const childLogger = makeMockLogger();
      const parentLogger = { ...mockLogger, child: vi.fn().mockReturnValue(childLogger) };

      let resolveExit!: (code: number) => void;
      const abortRuntime = createMockRuntime({
        launch: vi.fn().mockImplementation(() => new Promise((r) => { resolveLaunch = r; })),
        waitForExit: vi.fn().mockImplementation(() => new Promise((r) => { resolveExit = r; })),
        streamLogs: vi.fn().mockImplementation((_name: string, onLine: (line: string) => void) => {
          capturedOnLine = onLine;
          return { stop: vi.fn() };
        }),
      });

      const runner = new ContainerAgentRunner(
        abortRuntime, globalConfig, agentConfig, parentLogger as any,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      resolveLaunch("container-kill-test");

      // Wait for the run to get past launch
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      // Abort while running
      runner.abort();
      // Simulate container exiting non-zero after being killed
      resolveExit(137);

      const result = await runPromise;
      expect(result.result).toBe("error");
      expect(childLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ exitCode: 137 }),
        "container killed (abort requested)",
      );
    });
  });

  // ── run() exception path ─────────────────────────────────────────────────

  describe("run() when launch throws", () => {
    it("returns 'error' result when runtime.launch throws", async () => {
      const failRuntime = createMockRuntime({
        launch: vi.fn().mockRejectedValue(new Error("Docker daemon not running")),
      });
      const runner = createRunner({ runtime: failRuntime });
      const result = await runner.run("test prompt");
      expect(result.result).toBe("error");
    });

    it("includes error message in the run outcome when launch throws", async () => {
      const failRuntime = createMockRuntime({
        launch: vi.fn().mockRejectedValue(new Error("out of disk space")),
      });
      const runner = createRunner({ runtime: failRuntime });
      const result = await runner.run("test prompt");
      // result.result is "error", no exception thrown
      expect(result.result).toBe("error");
    });
  });

  // ── pi_auth model skip in credential resolution ──────────────────────────

  describe("run() with pi_auth model", () => {
    it("skips adding credential ref for pi_auth models", async () => {
      const piAuthConfig: AgentConfig = {
        name: "pi-agent",
        credentials: [],
        models: [
          { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "pi_auth" },
        ],
        schedule: "*/5 * * * *",
      };
      const runner = new ContainerAgentRunner(
        runtime, globalConfig, piAuthConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );
      const result = await runner.run("test prompt");
      // Should complete successfully without attempting to add anthropic_key credential
      expect(result.result).toBe("completed");
      // prepareCredentials is called with empty credRefs (pi_auth skipped)
      expect((runtime.prepareCredentials as any).mock.calls[0][0]).toEqual([]);
    });
  });

  // ── telemetry context injection ──────────────────────────────────────────

  describe("run() with active telemetry context", () => {
    it("injects OTEL_TRACE_PARENT env var when telemetry provides an active context", async () => {
      const mockTelemetryModule = await import("../../src/telemetry/index.js");

      const mockTelemetryManager = {
        getActiveContext: vi.fn().mockReturnValue("00-traceid-spanid-01"),
        withSpan: vi.fn().mockImplementation((_name: string, fn: (span: any) => any) =>
          fn({ setAttributes: vi.fn(), recordException: vi.fn(), setStatus: vi.fn(), end: vi.fn() })
        ),
      };

      const getTelemetrySpy = vi.spyOn(mockTelemetryModule, "getTelemetry")
        .mockReturnValue(mockTelemetryManager as any);

      const runner = new ContainerAgentRunner(
        runtime, globalConfig, agentConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      await runner.run("test prompt");

      getTelemetrySpy.mockRestore();

      // The runtime.launch should have been called with env including OTEL_TRACE_PARENT
      const launchCall = (runtime.launch as any).mock.calls[0][0];
      expect(launchCall.env).toMatchObject({ OTEL_TRACE_PARENT: "00-traceid-spanid-01" });
    });

    it("injects OTEL_EXPORTER_OTLP_ENDPOINT when telemetry endpoint is configured", async () => {
      const mockTelemetryModule = await import("../../src/telemetry/index.js");

      const mockTelemetryManager = {
        getActiveContext: vi.fn().mockReturnValue("00-traceid-spanid-02"),
        withSpan: vi.fn().mockImplementation((_name: string, fn: (span: any) => any) =>
          fn({ setAttributes: vi.fn(), recordException: vi.fn(), setStatus: vi.fn(), end: vi.fn() })
        ),
      };

      const getTelemetrySpy = vi.spyOn(mockTelemetryModule, "getTelemetry")
        .mockReturnValue(mockTelemetryManager as any);

      const configWithTelemetry: GlobalConfig = {
        telemetry: { enabled: true, endpoint: "http://localhost:4318", provider: "otlp" as any },
      };

      const runner = new ContainerAgentRunner(
        runtime, configWithTelemetry, agentConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      await runner.run("test prompt");

      getTelemetrySpy.mockRestore();

      const launchCall = (runtime.launch as any).mock.calls[0][0];
      expect(launchCall.env).toMatchObject({
        OTEL_TRACE_PARENT: "00-traceid-spanid-02",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      });
    });
  });

  describe("setRuntime()", () => {
    it("replaces the runtime used by the runner", async () => {
      const runner = createRunner();
      const newRuntime = createMockRuntime({
        launch: vi.fn().mockResolvedValue("new-container-456"),
      });
      runner.setRuntime(newRuntime);
      await runner.run("test prompt");
      // Should have used the new runtime's launch
      expect(newRuntime.launch).toHaveBeenCalled();
      expect((runtime.launch as any).mock.calls).toHaveLength(0);
    });
  });

  describe("abort() when runtime.kill throws", () => {
    it("does not propagate the error (swallows kill failure gracefully)", async () => {
      let resolveLaunch!: (value: string) => void;
      const killError = new Error("kill failed");
      const killingRuntime = createMockRuntime({
        launch: vi.fn().mockImplementation(() => new Promise((r) => { resolveLaunch = r; })),
        kill: vi.fn().mockRejectedValue(killError),
        waitForExit: vi.fn().mockResolvedValue(1), // non-zero to resolve run after abort
      });
      const childWarn = vi.fn();
      const loggerWithChild = {
        ...makeMockLogger(),
        child: () => ({ ...makeMockLogger(), warn: childWarn }),
      } as any;
      const runner = new ContainerAgentRunner(
        killingRuntime, globalConfig, agentConfig, loggerWithChild,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );
      const runPromise = runner.run("test prompt");
      await Promise.resolve();
      resolveLaunch("al-killing-container");
      await Promise.resolve();
      await Promise.resolve();

      runner.abort();
      // Allow the kill rejection to be processed
      await new Promise((r) => setTimeout(r, 50));

      const result = await runPromise;
      expect(result).toBeDefined();
      // The runner should have logged the kill failure as a warning
      expect(childWarn).toHaveBeenCalledWith(
        expect.objectContaining({ err: killError }),
        "Failed to kill container during abort",
      );
    });
  });

  describe("monitorContainer exception path", () => {
    it("catches exception from waitForExit and stops logStream in finally", async () => {
      const mockLogStop = vi.fn();
      const errorOnWait = new Error("waitForExit exploded");
      const failRuntime = createMockRuntime({
        streamLogs: vi.fn().mockReturnValue({ stop: mockLogStop }),
        waitForExit: vi.fn().mockRejectedValue(errorOnWait),
      });
      const childError = vi.fn();
      const loggerWithChild = {
        ...makeMockLogger(),
        child: () => ({ ...makeMockLogger(), error: childError }),
      } as any;
      const runner = new ContainerAgentRunner(
        failRuntime, globalConfig, agentConfig, loggerWithChild,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );
      const result = await runner.run("test prompt");

      // The error should be captured in runError → result is "error"
      expect(result.result).toBe("error");
      // logger.error should have been called with the monitoring failure message
      expect(childError).toHaveBeenCalledWith(
        expect.objectContaining({ err: errorOnWait }),
        expect.stringContaining("container monitoring failed"),
      );
      // logStream.stop() should have been called in the finally block (line 211)
      // because the exception was thrown while logStream was still set
      expect(mockLogStop).toHaveBeenCalled();
    });
  });

  describe("credential resolution — providerKey already present", () => {
    it("skips duplicate providerKey when credential ref already includes it", async () => {
      const configWithExistingKey: AgentConfig = {
        name: "test-agent",
        credentials: ["anthropic_key"],  // already has the key
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        schedule: "*/5 * * * *",
      };
      const runner = new ContainerAgentRunner(
        runtime, globalConfig, configWithExistingKey, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );
      await runner.run("test prompt");

      // prepareCredentials should be called with anthropic_key exactly once (not duplicated)
      const credRefs = (runtime.prepareCredentials as any).mock.calls[0][0];
      const anthropicKeyCount = credRefs.filter((r: string) => r === "anthropic_key").length;
      expect(anthropicKeyCount).toBe(1);
    });
  });

  describe("adoptContainer()", () => {
    it("re-registers, streams logs, waits for exit, then cleans up", async () => {
      const registerContainer = vi.fn().mockResolvedValue(undefined);
      const unregisterContainer = vi.fn().mockResolvedValue(undefined);
      const runner = new ContainerAgentRunner(
        runtime, globalConfig, agentConfig, mockLogger,
        registerContainer, unregisterContainer, "http://gateway:8080", "/tmp", "test-image:latest",
      );

      const outcome = await runner.adoptContainer("al-test-agent-abc", "my-secret", "test-agent-abc");

      expect(registerContainer).toHaveBeenCalledWith("my-secret", expect.objectContaining({
        containerName: "al-test-agent-abc",
        agentName: "test-agent",
        instanceId: "test-agent-abc",
      }));
      expect(runtime.streamLogs).toHaveBeenCalledWith("al-test-agent-abc", expect.any(Function), expect.any(Function));
      expect(runtime.waitForExit).toHaveBeenCalledWith("al-test-agent-abc", expect.any(Number));
      expect(unregisterContainer).toHaveBeenCalledWith("my-secret");
      expect(runtime.remove).toHaveBeenCalledWith("al-test-agent-abc");
      expect(outcome.result).toBe("completed");
    });

    it("returns error when container exits with non-zero code", async () => {
      const errorRuntime = createMockRuntime({
        waitForExit: vi.fn().mockResolvedValue(1),
      });
      const runner = new ContainerAgentRunner(
        errorRuntime, globalConfig, agentConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const outcome = await runner.adoptContainer("al-test-agent-err", "secret", "test-agent-err");
      expect(outcome.result).toBe("error");
    });

    it("returns rerun when container exits with code 42", async () => {
      const rerunRuntime = createMockRuntime({
        waitForExit: vi.fn().mockResolvedValue(42),
      });
      const runner = new ContainerAgentRunner(
        rerunRuntime, globalConfig, agentConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      const outcome = await runner.adoptContainer("al-test-agent-rerun", "secret", "test-agent-rerun");
      expect(outcome.result).toBe("rerun");
    });

    it("returns error immediately when runner is already busy", async () => {
      const runner = new ContainerAgentRunner(
        runtime, globalConfig, agentConfig, mockLogger,
        vi.fn(), vi.fn(), "", "/tmp", "test-image:latest",
      );

      // Start a run to mark the runner as busy
      const runPromise = runner.run("busy");
      await Promise.resolve(); // let it enter async

      const outcome = await runner.adoptContainer("other-container", "secret", "other-instance");
      expect(outcome.result).toBe("error");

      // Clean up
      await runPromise;
    });

    it("skips registerContainer when gatewayUrl is empty", async () => {
      const registerContainer = vi.fn().mockResolvedValue(undefined);
      const runner = new ContainerAgentRunner(
        runtime, globalConfig, agentConfig, mockLogger,
        registerContainer, vi.fn(), "", "/tmp", "test-image:latest",
      );

      await runner.adoptContainer("al-test-agent-nogw", "secret", "test-agent-nogw");
      expect(registerContainer).not.toHaveBeenCalled();
    });
  });
});
