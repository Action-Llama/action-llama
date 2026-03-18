import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerAgentRunner } from "../../src/agents/container-runner.js";
import type { ContainerRuntime, RuntimeCredentials } from "../../src/docker/runtime.js";
import type { GlobalConfig, AgentConfig } from "../../src/shared/config.js";

// Minimal mock runtime — only methods called during run() are mocked
function createMockRuntime(overrides: Partial<ContainerRuntime> = {}): ContainerRuntime {
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
  } as ContainerRuntime;
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
  model: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
  schedule: "*/5 * * * *",
};

describe("ContainerAgentRunner", () => {
  let runtime: ContainerRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = createMockRuntime();
  });

  function createRunner(opts?: { runtime?: ContainerRuntime }) {
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
});
