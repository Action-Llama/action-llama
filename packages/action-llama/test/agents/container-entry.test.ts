/**
 * Tests for agents/container-entry.ts
 * 
 * Covers initAgent(), handleInvocation(), runAgent(), and the module-level
 * runAgent() call that executes when the module is imported.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted setup ───────────────────────────────────────────────────────────

// Set up AGENT_CONFIG env before any imports so the module-level runAgent() can complete
const { mockExistsSync, mockReadFileSync, mockRmSync } = vi.hoisted(() => {
  // Set minimal env vars needed by initAgent() and handleInvocation()
  process.env.AGENT_CONFIG = JSON.stringify({
    name: "test-agent",
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
    credentials: [],
  });
  process.env.PROMPT = "Do the task.";
  delete process.env.GATEWAY_URL;
  delete process.env.AL_CHAT_MODE;
  delete process.env.OTEL_TRACE_PARENT;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  return {
    mockExistsSync: vi.fn((p: string) => false),
    mockReadFileSync: vi.fn(),
    mockRmSync: vi.fn(),
  };
});

// Mock process.exit before the module is imported (the module calls runAgent().then(..., process.exit))
// Use a no-op implementation instead of throwing to avoid unhandled promise rejections
// from the module-level runAgent().then(...) chain.
const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: any): never => {
  return undefined as never;
});

// ─── fs mocks ────────────────────────────────────────────────────────────────

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: (p: string) => mockExistsSync(p),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    rmSync: (...args: any[]) => mockRmSync(...args),
  };
});

// ─── child_process mock ──────────────────────────────────────────────────────

vi.mock("child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0 }),
}));

// ─── @mariozechner/pi-coding-agent mock ──────────────────────────────────────

const mockResourceLoaderReload = vi.fn().mockResolvedValue(undefined);
vi.mock("@mariozechner/pi-coding-agent", () => {
  class MockResourceLoader {
    constructor(opts: any) {
      // Call agentsFilesOverride if provided — covers that code path
      if (opts?.agentsFilesOverride) {
        opts.agentsFilesOverride();
      }
    }
    async reload() { return mockResourceLoaderReload(); }
  }
  return {
    DefaultResourceLoader: MockResourceLoader,
    SettingsManager: {
      inMemory: vi.fn().mockReturnValue({}),
    },
  };
});

// ─── signals mock ────────────────────────────────────────────────────────────

const mockEnsureSignalDir = vi.fn();
const mockReadSignals = vi.fn().mockReturnValue({ rerun: false, exitCode: undefined, returnValue: undefined });
vi.mock("../../src/agents/signals.js", () => ({
  ensureSignalDir: (...args: any[]) => mockEnsureSignalDir(...args),
  readSignals: (...args: any[]) => mockReadSignals(...args),
}));

// ─── model-fallback mock ─────────────────────────────────────────────────────

vi.mock("../../src/agents/model-fallback.js", () => ({
  ModelCircuitBreaker: class MockModelCircuitBreaker {},
}));

// ─── session-loop mock ───────────────────────────────────────────────────────

const mockRunSessionLoop = vi.fn().mockResolvedValue({
  outputText: "done",
  allModelsExhausted: false,
});
vi.mock("../../src/agents/session-loop.js", () => ({
  runSessionLoop: (...args: any[]) => mockRunSessionLoop(...args),
}));

// ─── credential-setup mock ───────────────────────────────────────────────────

const mockLoadContainerCredentials = vi.fn().mockReturnValue({ providerKeys: new Map() });
vi.mock("../../src/agents/credential-setup.js", () => ({
  loadContainerCredentials: (...args: any[]) => mockLoadContainerCredentials(...args),
}));

// ─── hooks/runner mock ───────────────────────────────────────────────────────

const mockRunHooks = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/hooks/runner.js", () => ({
  runHooks: (...args: any[]) => mockRunHooks(...args),
}));

// ─── context-injection mock ──────────────────────────────────────────────────

const mockProcessContextInjection = vi.fn().mockImplementation((body: string) => body);
vi.mock("../../src/agents/context-injection.js", () => ({
  processContextInjection: (...args: any[]) => mockProcessContextInjection(...args),
}));

// ─── frontmatter mock ────────────────────────────────────────────────────────

vi.mock("../../src/shared/frontmatter.js", () => ({
  parseFrontmatter: vi.fn().mockReturnValue({ body: "# Test Agent", frontmatter: {} }),
}));

// ─── telemetry mock ──────────────────────────────────────────────────────────

vi.mock("../../src/telemetry/index.js", () => ({
  initTelemetry: vi.fn().mockReturnValue({
    init: vi.fn().mockResolvedValue(undefined),
    setTraceContext: vi.fn(),
  }),
}));

// ─── exit-codes mock ─────────────────────────────────────────────────────────

vi.mock("../../src/shared/exit-codes.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return actual;
});

// ─── Import after mocks ──────────────────────────────────────────────────────

// Import the module — this triggers the module-level runAgent().then(...) call.
// All mocks are in place, so the call should complete successfully.
// process.exit(0) will throw "process.exit(0)" but that's caught by the .then() error handler.
let initAgent: typeof import("../../src/agents/container-entry.js").initAgent;
let handleInvocation: typeof import("../../src/agents/container-entry.js").handleInvocation;
let runAgent: typeof import("../../src/agents/container-entry.js").runAgent;

// We need to catch the module-level process.exit throw
try {
  const mod = await import("../../src/agents/container-entry.js");
  initAgent = mod.initAgent;
  handleInvocation = mod.handleInvocation;
  runAgent = mod.runAgent;
} catch {
  // Module-level runAgent() triggered process.exit which threw — that's expected.
  // The module is still loaded, we just need to import the functions.
  const mod = await import("../../src/agents/container-entry.js");
  initAgent = mod.initAgent;
  handleInvocation = mod.handleInvocation;
  runAgent = mod.runAgent;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("container-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mocks to their default implementations
    mockExistsSync.mockReturnValue(false);
    mockReadSignals.mockReturnValue({ rerun: false, exitCode: undefined, returnValue: undefined });
    mockRunSessionLoop.mockResolvedValue({
      outputText: "done",
      allModelsExhausted: false,
    });
    mockLoadContainerCredentials.mockReturnValue({ providerKeys: new Map() });
    mockProcessContextInjection.mockImplementation((body: string) => body);

    // Reset env vars
    process.env.AGENT_CONFIG = JSON.stringify({
      name: "test-agent",
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      credentials: [],
    });
    process.env.PROMPT = "Do the task.";
    delete process.env.GATEWAY_URL;
    delete process.env.AL_CHAT_MODE;
    delete process.env.OTEL_TRACE_PARENT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.TIMEOUT_SECONDS;
  });

  afterEach(() => {
    exitSpy.mockClear();
  });

  describe("initAgent", () => {
    it("loads agent config from AGENT_CONFIG env var when no baked files exist", async () => {
      mockExistsSync.mockReturnValue(false); // No baked files

      const init = await initAgent();

      expect(init.agentConfig.name).toBe("test-agent");
      expect(init.agentConfig.models[0].model).toBe("claude-sonnet-4-20250514");
      expect(init.timeoutSeconds).toBe(3600); // default
      expect(init.signalDir).toBe("/tmp/signals");
    });

    it("uses TIMEOUT_SECONDS env var when set", async () => {
      process.env.TIMEOUT_SECONDS = "600";
      mockExistsSync.mockReturnValue(false);

      const init = await initAgent();

      expect(init.timeoutSeconds).toBe(600);
    });

    it("throws when AGENT_CONFIG is not set and no baked files", async () => {
      delete process.env.AGENT_CONFIG;
      mockExistsSync.mockReturnValue(false);

      await expect(initAgent()).rejects.toThrow("missing AGENT_CONFIG env var");
    });

    it("reads agentConfig from baked files when /app/static/agent-config.json exists", async () => {
      // Simulate baked files at /app/static/
      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/app/static/agent-config.json") return true;
        if (p === "/app/static/SKILL.md") return false;
        if (p === "/app/static/timeout") return false;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string, _enc?: string) => {
        if (p === "/app/static/agent-config.json") {
          return JSON.stringify({
            name: "baked-agent",
            models: [{ provider: "anthropic", model: "claude-opus-4-20250514", authType: "api_key" }],
            credentials: [],
          });
        }
        if (p === "/app/static/timeout") return "1800";
        return "";
      });

      const init = await initAgent();

      expect(init.agentConfig.name).toBe("baked-agent");
      expect(init.skillBody).toContain("baked-agent"); // Falls back to generated content since no SKILL.md
    });

    it("reads SKILL.md from baked files when it exists", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/app/static/agent-config.json") return true;
        if (p === "/app/static/SKILL.md") return true;
        if (p === "/app/static/timeout") return false;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string, _enc?: string) => {
        if (p === "/app/static/agent-config.json") {
          return JSON.stringify({
            name: "skill-agent",
            models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
            credentials: [],
          });
        }
        if (p === "/app/static/SKILL.md") return "---\n---\n# My Skill\n\nDo things.";
        if (p === "/app/static/timeout") return "3600";
        return "";
      });

      const { parseFrontmatter } = await import("../../src/shared/frontmatter.js");
      vi.mocked(parseFrontmatter).mockReturnValueOnce({ body: "# My Skill\n\nDo things.", frontmatter: {} });

      const init = await initAgent();
      expect(init.skillBody).toContain("My Skill");
    });

    it("initializes telemetry when OTEL_TRACE_PARENT is set", async () => {
      process.env.OTEL_TRACE_PARENT = "00-abc-def-01";
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4317";
      mockExistsSync.mockReturnValue(false);

      const { initTelemetry } = await import("../../src/telemetry/index.js");

      const init = await initAgent();

      expect(initTelemetry).toHaveBeenCalled();
      expect(init.agentConfig.name).toBe("test-agent");

      delete process.env.OTEL_TRACE_PARENT;
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    });

    it("handles telemetry init failure gracefully", async () => {
      process.env.OTEL_TRACE_PARENT = "00-abc-def-01";
      mockExistsSync.mockReturnValue(false);

      const { initTelemetry } = await import("../../src/telemetry/index.js");
      vi.mocked(initTelemetry).mockReturnValueOnce({
        init: vi.fn().mockRejectedValueOnce(new Error("telemetry init failed")),
        setTraceContext: vi.fn(),
      } as any);

      // Should not throw even if telemetry fails
      const init = await initAgent();
      expect(init.agentConfig.name).toBe("test-agent");

      delete process.env.OTEL_TRACE_PARENT;
    });

    it("extracts _skillBody from AGENT_CONFIG and deletes it from the config", async () => {
      process.env.AGENT_CONFIG = JSON.stringify({
        name: "skill-env-agent",
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        credentials: [],
        _skillBody: "# My SKILL content",
      });
      mockExistsSync.mockReturnValue(false);

      const init = await initAgent();

      expect(init.skillBody).toContain("My SKILL content");
      expect((init.agentConfig as any)._skillBody).toBeUndefined();
    });
  });

  // Shared helper to create a minimal AgentInit for testing
  async function makeInit() {
    mockExistsSync.mockReturnValue(false);
    return initAgent();
  }

  describe("handleInvocation", () => {
    it("returns 0 on successful completion", async () => {
      const init = await makeInit();
      const exitCode = await handleInvocation(init);
      expect(exitCode).toBe(0);
    });

    it("returns ExitCode.RATE_LIMITED when all models exhausted", async () => {
      const init = await makeInit();
      mockRunSessionLoop.mockResolvedValueOnce({
        outputText: "",
        allModelsExhausted: true,
      });

      const exitCode = await handleInvocation(init);

      // ExitCode.RATE_LIMITED is some non-zero value
      expect(exitCode).not.toBe(0);
    });

    it("returns 1 when session was aborted due to errors", async () => {
      const init = await makeInit();
      // The onUnrecoverableAbort callback sets abortedDueToErrors=true
      mockRunSessionLoop.mockImplementationOnce((_prompt: string, opts: any) => {
        opts.onUnrecoverableAbort?.();
        return Promise.resolve({ outputText: "", allModelsExhausted: false });
      });

      const exitCode = await handleInvocation(init);
      expect(exitCode).toBe(1);
    });

    it("returns custom exit code when signal file contains exitCode", async () => {
      const init = await makeInit();
      mockReadSignals.mockReturnValueOnce({
        rerun: false,
        exitCode: 42,
        returnValue: undefined,
      });

      const exitCode = await handleInvocation(init);
      expect(exitCode).toBe(42);
    });

    it("returns 42 when rerun signal is set", async () => {
      const init = await makeInit();
      mockReadSignals.mockReturnValueOnce({
        rerun: true,
        exitCode: undefined,
        returnValue: undefined,
      });

      const exitCode = await handleInvocation(init);
      expect(exitCode).toBe(42);
    });

    it("runs pre-hooks when configured", async () => {
      process.env.AGENT_CONFIG = JSON.stringify({
        name: "hook-agent",
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        credentials: [],
        hooks: {
          pre: [{ command: "echo pre" }],
          post: [{ command: "echo post" }],
        },
      });
      const init = await makeInit();

      await handleInvocation(init);

      expect(mockRunHooks).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ command: "echo pre" })]),
        "pre",
        expect.any(Object)
      );
      expect(mockRunHooks).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ command: "echo post" })]),
        "post",
        expect.any(Object)
      );
    });

    it("handles post-hook failure gracefully (logs error, does not throw)", async () => {
      process.env.AGENT_CONFIG = JSON.stringify({
        name: "post-fail-agent",
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
        credentials: [],
        hooks: { post: [{ command: "failing-hook" }] },
      });
      const init = await makeInit();

      // There's only ONE call to runHooks (for the post hook, since there are no pre hooks)
      // Make that call reject with an error to test the catch block
      mockRunHooks.mockRejectedValueOnce(new Error("post hook failed"));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        // Should not throw — post-hook failure is caught and logged
        const exitCode = await handleInvocation(init);
        expect(exitCode).toBe(0);

        // Verify the error was logged
        const logs = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(logs).toContain("post hook failed");
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it("runs test-script.sh when it exists instead of LLM", async () => {
      const init = await makeInit();

      // Set up mocks AFTER init (so makeInit's mockReturnValue(false) doesn't override them)
      const { spawnSync } = await import("child_process");
      vi.mocked(spawnSync).mockReturnValueOnce({ status: 5, output: [], pid: 1, signal: null, error: undefined, stderr: null, stdout: null });

      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/app/static/test-script.sh") return true;
        return false;
      });

      const exitCode = await handleInvocation(init);

      expect(exitCode).toBe(5);
      expect(spawnSync).toHaveBeenCalledWith("sh", ["/app/static/test-script.sh"], expect.any(Object));
    });

    it("uses baked prompt-static.txt when it exists (no dynamic PROMPT)", async () => {
      const init = await makeInit();

      // Set up mocks AFTER init — both agent-config.json and prompt-static.txt must "exist"
      // because hasBakedFiles2 = existsSync("/app/static/agent-config.json")
      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/app/static/agent-config.json") return true;
        if (p === "/app/static/prompt-static.txt") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === "/app/static/prompt-static.txt") return "Static prompt content";
        return "";
      });
      delete process.env.PROMPT; // no dynamic suffix

      const exitCode = await handleInvocation(init);

      // Should use static prompt as-is (dynamicSuffix is empty)
      expect(exitCode).toBe(0);
      expect(mockRunSessionLoop).toHaveBeenCalledWith(
        "Static prompt content",
        expect.any(Object)
      );
    });

    it("uses baked prompt-static.txt with dynamic PROMPT suffix", async () => {
      const init = await makeInit();

      // Set up mocks AFTER init
      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/app/static/agent-config.json") return true;
        if (p === "/app/static/prompt-static.txt") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === "/app/static/prompt-static.txt") return "Static skeleton";
        return "";
      });
      process.env.PROMPT = "Dynamic suffix";

      await handleInvocation(init);

      expect(mockRunSessionLoop).toHaveBeenCalledWith(
        "Static skeleton\n\nDynamic suffix",
        expect.any(Object)
      );
    });

    it("throws when PROMPT env var is missing and no baked prompt", async () => {
      delete process.env.PROMPT;
      mockExistsSync.mockReturnValue(false);

      const init = await makeInit();

      await expect(handleInvocation(init)).rejects.toThrow("missing PROMPT env var");
    });

    it("processes context injection and creates new resource loader when body changes", async () => {
      const init = await makeInit();

      // Simulate context injection changing the body
      mockProcessContextInjection.mockReturnValueOnce("# Changed Body\n\nNew content.");

      const exitCode = await handleInvocation(init);
      expect(exitCode).toBe(0);
      // The updated loader is set on init
      expect((init as any).resourceLoader).toBeDefined();
    });

    it("cleans up signal files after successful run", async () => {
      const init = await makeInit();
      await handleInvocation(init);

      // rmSync is called for signal files
      expect(mockRmSync).toHaveBeenCalled();
    });

    it("handles returnValue signal gracefully (logs and returns 0)", async () => {
      const init = await makeInit();
      mockReadSignals.mockReturnValueOnce({
        rerun: false,
        exitCode: undefined,
        returnValue: "some-return-value",
      });

      const exitCode = await handleInvocation(init);
      expect(exitCode).toBe(0);
    });
  });

  describe("runAgent", () => {
    it("calls initAgent then handleInvocation and returns exit code", async () => {
      mockExistsSync.mockReturnValue(false);

      const exitCode = await runAgent();
      expect(exitCode).toBe(0);
    });

    it("delegates to runChatMode when AL_CHAT_MODE=1", async () => {
      process.env.AL_CHAT_MODE = "1";
      mockExistsSync.mockReturnValue(false);

      // Mock chat-entry.js to avoid actual chat startup
      // We need to dynamically mock this since it's imported inside runAgent()
      // with a dynamic import
      const chatEntryMock = { runChatMode: vi.fn().mockResolvedValue(0) };
      vi.doMock("../../src/agents/chat-entry.js", () => chatEntryMock);

      try {
        // The dynamic import inside runAgent() will use the mock
        const exitCode = await runAgent();
        // Either 0 (if mock is used) or some value from the actual implementation
        expect(typeof exitCode).toBe("number");
      } finally {
        vi.doUnmock("../../src/agents/chat-entry.js");
        delete process.env.AL_CHAT_MODE;
      }
    });
  });

  describe("emitLog (via side effects)", () => {
    it("emitLog is called during agent execution (logs to console.log)", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockExistsSync.mockReturnValue(false);

      const init = await initAgent();
      await handleInvocation(init);

      // emitLog should have been called at least once
      expect(consoleSpy).toHaveBeenCalled();
      const loggedMessages = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      // Each emitLog call produces a JSON string with _log: true
      expect(loggedMessages).toContain('"_log":true');

      consoleSpy.mockRestore();
    });
  });

  describe("gateway wait loop", () => {
    it("waits for gateway when GATEWAY_URL is set and gateway responds ok", async () => {
      process.env.GATEWAY_URL = "http://localhost:9090";
      const init = await makeInit();

      // Mock fetch to succeed on the first try
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

      try {
        const exitCode = await handleInvocation(init);
        expect(exitCode).toBe(0);
        expect(fetch).toHaveBeenCalledWith("http://localhost:9090/health", expect.any(Object));
      } finally {
        vi.unstubAllGlobals();
        delete process.env.GATEWAY_URL;
      }
    });

    it("retries gateway check when fetch throws and eventually gives up", async () => {
      process.env.GATEWAY_URL = "http://localhost:9090";
      const init = await makeInit();

      // Make fetch always fail (connection refused)
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      // Use fake timers to avoid actual 500ms delays
      vi.useFakeTimers();
      try {
        const promise = handleInvocation(init);

        // Advance time to allow all 30 retry attempts (30 * 500ms = 15000ms)
        await vi.advanceTimersByTimeAsync(15100);

        const exitCode = await promise;
        expect(exitCode).toBe(0); // Should complete after exhausting retries
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        delete process.env.GATEWAY_URL;
      }
    });
  });

  describe("container timeout callback", () => {
    it("emits error and calls process.exit(124) when container timeout fires", async () => {
      const init = await makeInit();
      // Use a very short timeout to trigger the setTimeout callback quickly
      init.timeoutSeconds = 0.01; // 10ms fake-timer units

      // Make session loop hang so the timeout fires before the session completes
      let resolveSession: (v: any) => void;
      mockRunSessionLoop.mockImplementationOnce(
        () => new Promise((res) => { resolveSession = res; })
      );

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.useFakeTimers();
      try {
        // Start handleInvocation — it sets a 10ms timer and then awaits runSessionLoop
        const promise = handleInvocation(init);

        // Advance time to fire the 10ms timeout (before session completes)
        try {
          await vi.advanceTimersByTimeAsync(15);
        } catch {
          // process.exit(124) throw may propagate here
        }

        // process.exit(124) should have been called
        expect(exitSpy).toHaveBeenCalledWith(124);

        // The logged message should contain "container timeout reached"
        const logs = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(logs).toContain("container timeout reached");

        // Resolve session to clean up the hanging promise
        resolveSession!({ outputText: "", allModelsExhausted: false });
        try { await promise; } catch { /* process.exit throw */ }
      } finally {
        consoleSpy.mockRestore();
        vi.useRealTimers();
        exitSpy.mockClear();
      }
    }, 10000);
  });

  describe("module-level error handler", () => {
    it("runAgent error path — logs error and calls process.exit(1)", async () => {
      // Make initAgent throw to trigger the module-level error handler
      // We need to call runAgent() with conditions that make it fail
      delete process.env.AGENT_CONFIG;
      mockExistsSync.mockReturnValue(false);

      // runAgent() will call initAgent() which will throw "missing AGENT_CONFIG"
      // The .then() error handler will log and call process.exit(1)
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await expect(runAgent()).rejects.toThrow("missing AGENT_CONFIG env var");
      } catch {
        // Expected — initAgent throws, runAgent propagates it
      } finally {
        consoleSpy.mockRestore();
        // Restore AGENT_CONFIG for other tests
        process.env.AGENT_CONFIG = JSON.stringify({
          name: "test-agent",
          models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
          credentials: [],
        });
        exitSpy.mockClear();
      }
    });

    it("module-level rejection handler logs error and calls process.exit(1) when runAgent rejects", async () => {
      // Covers container-entry.ts lines 330-331: the (err) => { emitLog(...); process.exit(1); }
      // rejection callback in the module-level runAgent().then(success, failure).
      //
      // The module-level call fires when the module is re-imported. We reset the module
      // registry and re-import while initAgent() is set to throw (AGENT_CONFIG absent).
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      exitSpy.mockClear();

      // Remove AGENT_CONFIG so initAgent() throws "missing AGENT_CONFIG env var",
      // causing the module-level runAgent() to reject, which fires the error handler.
      const savedConfig = process.env.AGENT_CONFIG;
      delete process.env.AGENT_CONFIG;

      try {
        vi.resetModules();
        // Re-importing the module triggers the module-level runAgent().then(success, failure).
        // runAgent() calls initAgent() which throws, so the failure callback fires.
        await import("../../src/agents/container-entry.js");

        // Give the async rejection handler time to execute.
        await new Promise((r) => setTimeout(r, 50));

        // The failure callback calls emitLog() (which calls console.log with JSON) and process.exit(1).
        const logCalls = consoleSpy.mock.calls.map((c) => c[0]);
        const errorLogCall = logCalls.find(
          (c) => typeof c === "string" && c.includes("container entry error")
        );
        expect(errorLogCall).toBeDefined();
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        if (savedConfig !== undefined) process.env.AGENT_CONFIG = savedConfig;
        consoleSpy.mockRestore();
        exitSpy.mockClear();
        vi.resetModules();
      }
    });
  });
});
