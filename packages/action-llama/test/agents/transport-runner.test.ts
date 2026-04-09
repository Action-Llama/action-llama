import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig, GlobalConfig, ModelConfig } from "../../src/shared/config.js";

// ── Mocks ──────────────────────────────────────────────────────

// Mock docker commands
const mockExecFileSync = vi.fn(() => "container-id\n");
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFileSync: (...args: any[]) => (mockExecFileSync as any)(...args),
  };
});

// Mock the Pi session
const mockPrompt = vi.fn();
const mockDispose = vi.fn();
const mockSubscribe = vi.fn();
const mockGetSessionStats = vi.fn(() => ({
  totalInputTokens: 100,
  totalOutputTokens: 50,
  turns: 1,
}));
const mockGetContextUsage = vi.fn(() => ({ percent: 5.0, contextWindow: 200000, tokens: 10000 }));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({ provider: "test", model: "test-model" })),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
  createAgentSession: vi.fn(async () => ({
    session: {
      prompt: mockPrompt,
      dispose: mockDispose,
      subscribe: mockSubscribe,
      getSessionStats: mockGetSessionStats,
      getContextUsage: mockGetContextUsage,
    },
    extensionsResult: {},
  })),
  SessionManager: { inMemory: () => ({}) },
  SettingsManager: { inMemory: (opts: any) => ({}) },
  DefaultResourceLoader: vi.fn().mockImplementation(function () {
    return { reload: vi.fn() };
  }),
}));

// Mock transport
const mockExec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
const mockReadFiles = vi.fn(async () => new Map());
const mockWriteFiles = vi.fn(async () => {});
const mockClose = vi.fn(async () => {});
const mockConnect = vi.fn(async () => {});

vi.mock("../../src/transport/docker-exec.js", () => ({
  DockerExecTransport: vi.fn().mockImplementation(function () {
    return {
      connect: mockConnect,
      exec: mockExec,
      readFiles: mockReadFiles,
      writeFiles: mockWriteFiles,
      close: mockClose,
    };
  }),
}));

// Mock transport operations
vi.mock("../../src/transport/operations.js", () => ({
  createTransportTools: vi.fn(() => []),
}));

// Mock image building — return the baseImage unchanged (no Docker needed for unit tests)
vi.mock("../../src/docker/image.js", () => ({
  ensureAgentImage: vi.fn(async (_name: string, _path: string, baseImage: string) => baseImage),
  ensureProjectBaseImage: vi.fn(async (_path: string, baseImage: string) => baseImage),
  imageExists: vi.fn(() => true),
}));

// Mock credentials
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep), instance: ref.slice(sep + 1) };
  },
  getDefaultBackend: () => ({
    readAll: vi.fn(async (type: string, instance: string) => {
      if (type === "anthropic_key") return { api_key: "sk-test-key" };
      if (type === "github_token") return { token: "ghp-test" };
      return null;
    }),
  }),
}));

// Mock frontmatter
vi.mock("../../src/shared/frontmatter.js", () => ({
  parseFrontmatter: (content: string) => ({ body: content, frontmatter: {} }),
}));

// Mock telemetry
vi.mock("../../src/telemetry/index.js", () => ({
  withSpan: vi.fn(async (_name: string, fn: (span: any) => Promise<any>) => {
    const mockSpan = { setAttributes: vi.fn(), recordException: vi.fn() };
    return fn(mockSpan);
  }),
}));

// Mock usage conversion
vi.mock("../../src/shared/usage.js", () => ({
  sessionStatsToUsage: (stats: any) => ({
    inputTokens: stats.totalInputTokens || 0,
    outputTokens: stats.totalOutputTokens || 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0),
    cost: 0.01,
    turnCount: stats.turns || 0,
  }),
}));

// Mock model fallback
vi.mock("../../src/agents/model-fallback.js", () => ({
  ModelCircuitBreaker: vi.fn().mockImplementation(() => ({
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  })),
  selectAvailableModels: (models: any[]) => models,
  isRateLimitError: (msg: string) => msg.includes("rate limit") || msg.includes("429"),
}));

// Import after mocks
const { TransportAgentRunner } = await import("../../src/agents/transport-runner.js");

// ── Test helpers ───────────────────────────────────────────────

function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: "test-agent",
    credentials: [],
    models: [{
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      thinkingLevel: "medium",
    }] as ModelConfig[],
    ...overrides,
  };
}

function makeGlobalConfig(overrides?: Partial<GlobalConfig>): GlobalConfig {
  return {
    models: {},
    ...overrides,
  } as GlobalConfig;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => makeLogger()),
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────

describe("TransportAgentRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrompt.mockResolvedValue(undefined);
    mockExecFileSync.mockReturnValue("container-id\n");
  });

  it("implements PoolRunner interface", () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    expect(typeof runner.run).toBe("function");
    expect(typeof runner.abort).toBe("function");
    expect(typeof runner.isRunning).toBe("boolean");
    expect(typeof runner.instanceId).toBe("string");
  });

  it("provisions a container and connects transport", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    const outcome = await runner.run("Test prompt");

    // Should have called docker run to provision
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["run", "-d", "--name", expect.stringContaining("al-test-agent-")]),
      expect.any(Object),
    );

    // Should have connected transport
    expect(mockConnect).toHaveBeenCalled();

    // Should have completed
    expect(outcome.result).toBe("completed");
  });

  it("stages credentials via transport", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig({
        credentials: ["github_token"],
      }),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    await runner.run("Test prompt");

    // Should have created credential directories and written files
    expect(mockExec).toHaveBeenCalledWith("rm -rf /credentials 2>/dev/null; mkdir -p /credentials");
    expect(mockWriteFiles).toHaveBeenCalled();
  });

  it("cleans up container on completion", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    await runner.run("Test prompt");

    // Should close transport
    expect(mockClose).toHaveBeenCalled();

    // Should remove container
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["rm", "-f"]),
      expect.any(Object),
    );
  });

  it("cleans up container on error", async () => {
    mockPrompt.mockRejectedValue(new Error("session failed"));

    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    const outcome = await runner.run("Test prompt");

    expect(outcome.result).toBe("error");
    expect(outcome.exitReason).toContain("session failed");

    // Should still clean up
    expect(mockClose).toHaveBeenCalled();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["rm", "-f"]),
      expect.any(Object),
    );
  });

  it("rejects concurrent runs", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    // Simulate a long-running session
    let resolvePrompt: () => void;
    mockPrompt.mockReturnValue(new Promise<void>((r) => { resolvePrompt = r; }));

    const run1 = runner.run("Prompt 1");
    // Wait a tick for the first run to start
    await new Promise((r) => setTimeout(r, 10));

    const outcome2 = await runner.run("Prompt 2");
    expect(outcome2.result).toBe("error");

    // Clean up first run
    resolvePrompt!();
    await run1;
  });

  it("sets isRunning correctly", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    expect(runner.isRunning).toBe(false);

    let resolvePrompt: () => void;
    mockPrompt.mockReturnValue(new Promise<void>((r) => { resolvePrompt = r; }));

    const runPromise = runner.run("Test");
    await new Promise((r) => setTimeout(r, 10));
    expect(runner.isRunning).toBe(true);

    resolvePrompt!();
    await runPromise;
    expect(runner.isRunning).toBe(false);
  });

  it("returns usage stats from Pi session", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    const outcome = await runner.run("Test prompt");

    expect(outcome.usage).toBeDefined();
    expect(outcome.usage!.inputTokens).toBe(100);
    expect(outcome.usage!.outputTokens).toBe(50);
    expect(outcome.usage!.turnCount).toBe(1);
  });

  it("runs pre and post hooks via transport", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig({
        hooks: {
          pre: ["git clone https://github.com/test/repo"],
          post: ["echo done"],
        },
      }),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    await runner.run("Test prompt");

    expect(mockExec).toHaveBeenCalledWith("git clone https://github.com/test/repo");
    expect(mockExec).toHaveBeenCalledWith("echo done");
  });

  it("handles rate limiting with model fallback", async () => {
    mockPrompt
      .mockRejectedValueOnce(new Error("rate limit exceeded (429)"))
      .mockResolvedValueOnce(undefined);

    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig({
        models: [
          { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium" },
          { provider: "anthropic", model: "claude-haiku-3-5-20241022", thinkingLevel: "none" as any },
        ] as ModelConfig[],
      }),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    const outcome = await runner.run("Test prompt");
    expect(outcome.result).toBe("completed");
  });

  it("generates unique instance IDs", async () => {
    const runner = new TransportAgentRunner({
      globalConfig: makeGlobalConfig(),
      agentConfig: makeAgentConfig(),
      logger: makeLogger(),
      circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn() } as any,
      baseImage: "al-base:latest",
      projectPath: "/project",
    });

    await runner.run("Test 1");
    const id1 = runner.instanceId;

    await runner.run("Test 2");
    const id2 = runner.instanceId;

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^test-agent-/);
    expect(id2).toMatch(/^test-agent-/);
  });
});
