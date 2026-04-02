import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTmpProject } from "../../helpers.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir, homedir } from "os";
import { fileURLToPath } from "url";
import { writeEnvironmentConfig, environmentPath } from "../../../src/shared/environment.js";

// Mock pi-coding-agent to avoid launching real console
const mockRun = vi.fn().mockResolvedValue(undefined);
let capturedOptions: any;
vi.mock("@mariozechner/pi-coding-agent", () => {
  class MockResourceLoader {
    private opts: any;
    constructor(opts: any) { this.opts = opts; }
    async reload() {
      // Call agentsFilesOverride if provided (covers that code path)
      if (this.opts?.agentsFilesOverride) {
        this.opts.agentsFilesOverride();
      }
    }
  }
  class MockInteractiveMode {
    constructor(_session: any, options: any) { capturedOptions = options; }
    async run() { return mockRun(); }
  }
  return {
    AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
    createAgentSession: vi.fn().mockResolvedValue({ session: { dispose: vi.fn() } }),
    DefaultResourceLoader: MockResourceLoader,
    SessionManager: { inMemory: vi.fn() },
    SettingsManager: { inMemory: vi.fn() },
    createCodingTools: vi.fn().mockReturnValue([]),
    InteractiveMode: MockInteractiveMode,
  };
});

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ id: "claude-sonnet-4-20250514", provider: "anthropic" }),
}));

vi.mock("../../../src/control/api-key.js", () => ({
  ensureGatewayApiKey: vi.fn().mockResolvedValue({ key: "test-api-key-12345", generated: false }),
  loadGatewayApiKey: vi.fn().mockResolvedValue("test-api-key-12345"),
}));

const mockRemoteTransportConnect = vi.fn().mockResolvedValue(undefined);
const mockRemoteTransportClose = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/chat/remote-transport.js", () => {
  class MockRemoteTransport {
    constructor(_opts: any) {}
    connect() { return mockRemoteTransportConnect(); }
    close() { return mockRemoteTransportClose(); }
  }
  return { RemoteTransport: MockRemoteTransport };
});

const mockRunChatTUI = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/chat/ink-adapter.js", () => ({
  runChatTUI: mockRunChatTUI,
}));

vi.mock("../../../src/shared/credentials.js", () => ({
  loadCredentialField: vi.fn().mockResolvedValue("sk-ant-api-test"),
  loadCredentialFields: vi.fn().mockResolvedValue({ token: "sk-ant-api-test" }),
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  requireCredentialRef: () => {},
  writeCredentialField: () => {},
  writeCredentialFields: () => {},
  credentialExists: () => true,
  backendLoadField: () => Promise.resolve("sk-ant-api-test"),
  backendLoadFields: () => Promise.resolve({}),
  backendCredentialExists: () => Promise.resolve(true),
  backendListInstances: () => Promise.resolve([]),
  backendRequireCredentialRef: () => Promise.resolve(),
  getDefaultBackend: () => {},
  setDefaultBackend: () => {},
  resetDefaultBackend: () => {},
}));

let capturedCwd: string | undefined;
vi.mock("../../../src/cli/commands/chat.js", async (importOriginal) => {
  const original = await importOriginal() as any;
  return original;
});

import { execute } from "../../../src/cli/commands/chat.js";
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { ensureGatewayApiKey } from "../../../src/control/api-key.js";
import { loadCredentialFields } from "../../../src/shared/credentials.js";

describe("chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = undefined;
    // Mock fetch so probeGateway always reports no gateway running
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
  });

  it("launches console with agent summary when agents exist", async () => {
    const dir = makeTmpProject();
    await execute({ project: dir });

    expect(mockRun).toHaveBeenCalled();
    expect(capturedOptions.initialMessage).toContain("agent");
    expect(capturedOptions.initialMessage).toContain("What would you like to do");
  });

  it("launches console with short initial message when no agents exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "al-empty-"));
    await execute({ project: dir });

    expect(mockRun).toHaveBeenCalled();
    // Initial message should be short — template details are in system context, not the user prompt
    expect(capturedOptions.initialMessage).toContain("first agent");
  });

  it("launches agent-scoped session when agent name is provided", async () => {
    const dir = makeTmpProject();
    await execute({ project: dir, agent: "dev" });

    expect(mockRun).toHaveBeenCalled();
    expect(capturedOptions.initialMessage).toContain('"dev"');
    // Should use agent dir as cwd
    const call = (createAgentSession as any).mock.calls[0][0];
    expect(call.cwd).toContain("dev");
  });

  it("throws when agent does not exist", async () => {
    const dir = makeTmpProject();
    await expect(execute({ project: dir, agent: "nonexistent" }))
      .rejects.toThrow('Agent "nonexistent" not found');
  });

  it("warns when gateway is not reachable in agent mode", async () => {
    const dir = makeTmpProject();
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    try {
      await execute({ project: dir, agent: "dev" });
    } finally {
      console.log = orig;
    }
    const output = logs.join("\n");
    expect(output).toContain("No gateway detected");
    expect(output).toContain("al start");
  });

  it("does not warn when gateway IS reachable in agent mode", async () => {
    // Override fetch to simulate a healthy gateway
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const dir = makeTmpProject();
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    try {
      await execute({ project: dir, agent: "dev" });
    } finally {
      console.log = orig;
    }
    const output = logs.join("\n");
    expect(output).not.toContain("No gateway detected");
    expect(mockRun).toHaveBeenCalled();
  });

  it("configures git credential helper when GITHUB_TOKEN is set", async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    try {
      process.env.GITHUB_TOKEN = "ghp_test_token_12345";
      const dir = makeTmpProject();
      await execute({ project: dir, agent: "dev" });
      // After execute, the injected env vars should have been cleaned up
      // The test mainly verifies that no error was thrown when GITHUB_TOKEN is present
      expect(mockRun).toHaveBeenCalled();
    } finally {
      if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = savedToken;
      // Clean up any git config env vars that may have leaked
      delete process.env.GIT_TERMINAL_PROMPT;
    }
  });

  it("sets up SSH key when agent has git_ssh credential", async () => {
    const dir = makeTmpProject({
      agents: [{ name: "dev", credentials: ["github_token", "git_ssh"] }],
    });
    await execute({ project: dir, agent: "dev" });
    // Should complete without throwing — the code path writes a temp SSH key
    expect(mockRun).toHaveBeenCalled();
  });

  it("uses remote transport when opts.env and gateway URL are configured", async () => {
    const testEnvName = `test-chat-remote-${Date.now()}`;
    try {
      // Create a real environment config with a gateway URL
      writeEnvironmentConfig(testEnvName, {
        gateway: { url: "http://remote-host:9090", port: 9090 },
      });

      const dir = makeTmpProject();

      const logs: string[] = [];
      const orig = console.log;
      console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
      try {
        await execute({ project: dir, agent: "dev", env: testEnvName });
      } finally {
        console.log = orig;
      }

      // Remote transport should have been used
      expect(mockRemoteTransportConnect).toHaveBeenCalled();
      expect(mockRunChatTUI).toHaveBeenCalled();
      expect(mockRemoteTransportClose).toHaveBeenCalled();
      expect(logs.join("\n")).toContain("Connecting to");
    } finally {
      try { rmSync(environmentPath(testEnvName)); } catch {}
    }
  });

  it("falls through to local agent chat when env has no gateway URL", async () => {
    const testEnvName = `test-chat-local-${Date.now()}`;
    try {
      // Create an env config WITHOUT a gateway URL
      writeEnvironmentConfig(testEnvName, {});

      const dir = makeTmpProject();
      await execute({ project: dir, agent: "dev", env: testEnvName });

      // Should fall back to local agent chat
      expect(mockRun).toHaveBeenCalled();
      // Remote transport should NOT have been used
      expect(mockRemoteTransportConnect).not.toHaveBeenCalled();
    } finally {
      try { rmSync(environmentPath(testEnvName)); } catch {}
    }
  });

  it("prints shortcuts including submit and newLine keys", async () => {
    const dir = makeTmpProject();
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    try {
      await execute({ project: dir });
    } finally {
      console.log = orig;
    }

    const output = logs.join("\n");
    expect(output).toContain("send");
    expect(output).toContain("new line");
    expect(output).toContain("Ctrl+C");
    expect(output).toContain("Ctrl+D");
  });

  it("includes '(could not load config)' in initial message for agents with broken config.toml", async () => {
    // Create a project with one agent that has an invalid config.toml
    const dir = makeTmpProject({
      agents: [{ name: "dev" }],
    });
    // Overwrite dev's config.toml with invalid TOML so loadAgentConfig throws
    writeFileSync(resolve(dir, "agents", "dev", "config.toml"), "this is [invalid] = toml\n");

    capturedOptions = undefined;
    await execute({ project: dir });

    // The agent summary in the initialMessage should contain the fallback
    expect(capturedOptions?.initialMessage).toContain("could not load config");
  });

  it("throws when executeRemoteChat receives null api key", async () => {
    // Mock ensureGatewayApiKey to return null key
    vi.mocked(ensureGatewayApiKey).mockResolvedValueOnce({ key: null as any, generated: false });

    const testEnvName = `test-chat-nokey-${Date.now()}`;
    try {
      writeEnvironmentConfig(testEnvName, {
        gateway: { url: "http://remote-host:9090", port: 9090 },
      });

      const dir = makeTmpProject();
      await expect(
        execute({ project: dir, agent: "dev", env: testEnvName })
      ).rejects.toThrow("Gateway API key not found");
    } finally {
      try { rmSync(environmentPath(testEnvName)); } catch {}
    }
  });

  it("skips credential when loadCredentialFields returns null (stmt 41: if (!fields) continue)", async () => {
    // Mock loadCredentialFields to return null for the first call — triggers the continue branch
    vi.mocked(loadCredentialFields).mockResolvedValueOnce(null as any);

    const dir = makeTmpProject();
    // execute should succeed even when credential fields are null (just skipped)
    await execute({ project: dir, agent: "dev" });
    expect(mockRun).toHaveBeenCalled();
  });

  it("probeGateway aborts fetch when timeout fires (covers setTimeout callback)", async () => {
    // Simulate a slow gateway that never responds — the AbortController timeout fires
    vi.useFakeTimers();
    let fetchAborted = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener?.("abort", () => {
          fetchAborted = true;
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    }));

    try {
      const dir = makeTmpProject();
      // Start execute but don't await yet — probeGateway will be called and wait for fetch
      const execPromise = execute({ project: dir, agent: "dev" });

      // Advance time async — this allows pending microtasks/timers to run
      // The 2000ms timeout in probeGateway fires, aborting the fetch request
      await vi.advanceTimersByTimeAsync(3000);

      // execute should complete now (fetch rejected → probeGateway returns false)
      await execPromise;
      expect(fetchAborted).toBe(true);
      expect(mockRun).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }, 10000);

  describe("ensureKeybindings and readKeybindings coverage", () => {
    function keybindingsPath() {
      return join(homedir(), ".pi", "agent", "keybindings.json");
    }

    it("creates keybindings file when it does not exist (ensureKeybindings creation path)", async () => {
      const kbPath = keybindingsPath();
      let savedContent: string | null = null;

      // Save existing file content and remove it
      try {
        savedContent = readFileSync(kbPath, "utf-8");
        rmSync(kbPath);
      } catch {
        // File doesn't exist — that's fine
      }

      try {
        // execute() calls ensureKeybindings() which should create the file
        const dir = makeTmpProject();
        await execute({ project: dir });

        // The keybindings file should now exist with the default AL keybindings
        expect(existsSync(kbPath)).toBe(true);
        const content = JSON.parse(readFileSync(kbPath, "utf-8"));
        expect(content).toHaveProperty("newLine");
        expect(mockRun).toHaveBeenCalled();
      } finally {
        // Restore original content
        if (savedContent !== null) {
          mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
          writeFileSync(kbPath, savedContent);
        } else {
          try { rmSync(kbPath); } catch {}
        }
      }
    });

    it("returns empty object from readKeybindings when file contains invalid JSON (catch path)", async () => {
      const kbPath = keybindingsPath();
      let savedContent: string | null = null;

      // Save existing file content and replace with invalid JSON
      try {
        savedContent = readFileSync(kbPath, "utf-8");
      } catch {
        // File doesn't exist — savedContent stays null
      }
      mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
      writeFileSync(kbPath, "this is not valid JSON {{");

      try {
        // execute() calls readKeybindings() which should catch the JSON parse error and return {}
        const dir = makeTmpProject();
        await execute({ project: dir });
        // execute completed successfully — readKeybindings gracefully returned {}
        expect(mockRun).toHaveBeenCalled();
      } finally {
        // Restore original content
        if (savedContent !== null) {
          writeFileSync(kbPath, savedContent);
        } else {
          try { rmSync(kbPath); } catch {}
        }
      }
    });
  });

  describe("loadExampleTemplate coverage", () => {
    it("loads example SKILL.md when docs/examples/<type>/SKILL.md exists (loadExampleTemplate success path)", async () => {
      // Determine the package root — same logic as resolvePackageRoot() in chat.ts:
      // 4 levels up from the source file: src/cli/commands/chat.ts → packages/action-llama
      // In vitest, import.meta.url refers to the test file path:
      // test/cli/commands/chat.test.ts → packages/action-llama
      const packageRoot = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        ".."
      );
      const exampleDir = join(packageRoot, "docs", "examples", "dev");
      const skillPath = join(exampleDir, "SKILL.md");

      // Create the example SKILL.md temporarily
      mkdirSync(exampleDir, { recursive: true });
      writeFileSync(skillPath, "---\n---\n# Dev Agent\n\nExample template content.\n");

      try {
        // Execute with no agents so buildNoAgentsContext() runs and calls loadExampleTemplate()
        const emptyDir = mkdtempSync(join(tmpdir(), "al-chat-tpl-"));
        try {
          await execute({ project: emptyDir });
          // loadExampleTemplate("dev") finds the file and returns its content;
          // templateSections.push() runs for the dev template
          expect(mockRun).toHaveBeenCalled();
        } finally {
          rmSync(emptyDir, { recursive: true, force: true });
        }
      } finally {
        // Clean up example files
        try { rmSync(join(packageRoot, "docs"), { recursive: true, force: true }); } catch {}
      }
    });
  });
});
