import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { makeTmpProject, makeAgentConfig, captureLog } from "../../helpers.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLoadAgentConfig = vi.fn();
const mockLoadAgentBody = vi.fn().mockReturnValue("# Agent\n\nCustom agent.\n");
const mockLoadGlobalConfig = vi.fn().mockReturnValue({});

vi.mock("../../../src/shared/config.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadAgentConfig: (...args: any[]) => mockLoadAgentConfig(...args),
    loadAgentBody: (...args: any[]) => mockLoadAgentBody(...args),
    loadGlobalConfig: (...args: any[]) => mockLoadGlobalConfig(...args),
  };
});

const mockBuildPromptSkeleton = vi.fn().mockReturnValue("prompt skeleton");
vi.mock("../../../src/agents/prompt.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    buildPromptSkeleton: (...args: any[]) => mockBuildPromptSkeleton(...args),
  };
});

const mockProcessContextInjection = vi.fn().mockImplementation((body: string) => body);
vi.mock("../../../src/agents/context-injection.js", () => ({
  processContextInjection: (...args: any[]) => mockProcessContextInjection(...args),
}));

const mockEnsureSignalDir = vi.fn();
const mockReadSignals = vi.fn().mockReturnValue({});
vi.mock("../../../src/agents/signals.js", () => ({
  ensureSignalDir: (...args: any[]) => mockEnsureSignalDir(...args),
  readSignals: (...args: any[]) => mockReadSignals(...args),
}));

const mockModelCircuitBreaker = vi.fn();
vi.mock("../../../src/agents/model-fallback.js", () => ({
  ModelCircuitBreaker: function () { return mockModelCircuitBreaker(); },
}));

const mockGetExitCodeMessage = vi.fn().mockReturnValue("signal exit reason");
vi.mock("../../../src/shared/exit-codes.js", () => ({
  getExitCodeMessage: (...args: any[]) => mockGetExitCodeMessage(...args),
}));

const mockRunSessionLoop = vi.fn().mockResolvedValue({ outputText: "done" });
vi.mock("../../../src/agents/session-loop.js", () => ({
  runSessionLoop: (...args: any[]) => mockRunSessionLoop(...args),
}));

const mockRunHooks = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/hooks/runner.js", () => ({
  runHooks: (...args: any[]) => mockRunHooks(...args),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  DefaultResourceLoader: class {
    private opts: any;
    constructor(opts: any) { this.opts = opts; }
    async reload() {
      // Call the agentsFilesOverride to exercise that code path
      if (this.opts?.agentsFilesOverride) {
        this.opts.agentsFilesOverride();
      }
    }
  },
  SettingsManager: {
    inMemory: vi.fn().mockReturnValue({}),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal credentials directory with a provider API key */
function makeCredDir(provider = "anthropic"): string {
  const dir = mkdtempSync(join(tmpdir(), "al-creds-test-"));
  const keyDir = join(dir, `${provider}_key`, "default");
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(join(keyDir, "token"), "test-api-key-12345");
  return dir;
}

/** Default AgentConfig used in tests */
function defaultAgentConfig() {
  return makeAgentConfig({
    name: "dev",
    credentials: ["github_token"],
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }],
    schedule: "*/5 * * * *",
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

import { execute } from "../../../src/cli/commands/run-agent.js";

describe("cli/commands/run-agent execute", () => {
  let projectPath: string;
  let credDir: string;
  let workDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let chdirSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();

    projectPath = makeTmpProject();
    credDir = makeCredDir();
    workDir = mkdtempSync(join(tmpdir(), "al-work-test-"));

    // Save env vars
    savedEnv.AL_CREDENTIALS_PATH = process.env.AL_CREDENTIALS_PATH;
    savedEnv.AL_WORK_DIR = process.env.AL_WORK_DIR;
    savedEnv.AL_ENV_FILE = process.env.AL_ENV_FILE;
    savedEnv.AL_SIGNAL_DIR = process.env.AL_SIGNAL_DIR;
    savedEnv.GATEWAY_URL = process.env.GATEWAY_URL;
    savedEnv.PROMPT = process.env.PROMPT;

    // Set required env vars
    process.env.AL_CREDENTIALS_PATH = credDir;
    delete process.env.AL_WORK_DIR;
    delete process.env.GATEWAY_URL;
    delete process.env.PROMPT;

    // Mock process.exit to throw so tests can assert on it
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: any): never => {
      throw new Error(`process.exit(${_code})`);
    });

    // Mock process.chdir to avoid changing cwd in tests
    chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});

    // Set up default mocks
    mockLoadAgentConfig.mockReturnValue(defaultAgentConfig());
    mockRunSessionLoop.mockResolvedValue({ outputText: "session output" });
    mockReadSignals.mockReturnValue({});
    mockModelCircuitBreaker.mockReturnValue({});
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }

    exitSpy.mockRestore();
    chdirSpy.mockRestore();
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(credDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("missing AL_CREDENTIALS_PATH", () => {
    it("throws when AL_CREDENTIALS_PATH is not set", async () => {
      delete process.env.AL_CREDENTIALS_PATH;
      await expect(execute("dev", { project: projectPath })).rejects.toThrow(
        "AL_CREDENTIALS_PATH not set",
      );
    });

    it("error message mentions HostUserRuntime", async () => {
      delete process.env.AL_CREDENTIALS_PATH;
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("HostUserRuntime");
    });
  });

  describe("successful execution (process.exit(0))", () => {
    it("calls process.exit(0) on normal completion", async () => {
      mockReadSignals.mockReturnValue({});

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("calls loadAgentConfig with the project path and agent name", async () => {
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockLoadAgentConfig).toHaveBeenCalledWith(
        expect.stringContaining(projectPath),
        "dev",
      );
    });

    it("calls loadGlobalConfig with the project path", async () => {
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockLoadGlobalConfig).toHaveBeenCalledWith(expect.stringContaining(projectPath));
    });

    it("calls runSessionLoop with the built prompt", async () => {
      mockBuildPromptSkeleton.mockReturnValue("system prompt skeleton");

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockRunSessionLoop).toHaveBeenCalledWith(
        "system prompt skeleton",
        expect.objectContaining({
          models: expect.arrayContaining([
            expect.objectContaining({ provider: "anthropic" }),
          ]),
        }),
      );
    });

    it("combines skeleton and PROMPT env var into fullPrompt", async () => {
      process.env.PROMPT = "Do the thing";
      mockBuildPromptSkeleton.mockReturnValue("skeleton");

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockRunSessionLoop).toHaveBeenCalledWith(
        "skeleton\n\nDo the thing",
        expect.anything(),
      );
    });

    it("calls ensureSignalDir to create the signal directory", async () => {
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockEnsureSignalDir).toHaveBeenCalledWith(expect.stringContaining("signals"));
    });

    it("calls processContextInjection on the skill body", async () => {
      mockLoadAgentBody.mockReturnValue("Custom skill body");

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockProcessContextInjection).toHaveBeenCalledWith(
        "Custom skill body",
        expect.any(Object),
      );
    });

    it("uses default skill body when loadAgentBody returns null", async () => {
      mockLoadAgentBody.mockReturnValue(null);

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockProcessContextInjection).toHaveBeenCalledWith(
        expect.stringContaining("Agent"),
        expect.any(Object),
      );
    });

    it("passes providerKeys from credentials to runSessionLoop", async () => {
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockRunSessionLoop).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          providerKeys: expect.any(Map),
        }),
      );
    });
  });

  describe("AL_WORK_DIR handling", () => {
    it("calls process.chdir when AL_WORK_DIR is set", async () => {
      process.env.AL_WORK_DIR = workDir;

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(chdirSpy).toHaveBeenCalledWith(workDir);
    });

    it("does not call process.chdir when AL_WORK_DIR is not set", async () => {
      delete process.env.AL_WORK_DIR;

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(chdirSpy).not.toHaveBeenCalled();
    });

    it("sets HOME to AL_WORK_DIR when provided", async () => {
      process.env.AL_WORK_DIR = workDir;
      const origHome = process.env.HOME;

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(process.env.HOME).toBe(workDir);
      process.env.HOME = origHome;
    });
  });

  describe("signal handling", () => {
    it("calls process.exit(42) when rerun signal is set", async () => {
      mockReadSignals.mockReturnValue({ rerun: true });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(42)");
      expect(exitSpy).toHaveBeenCalledWith(42);
    });

    it("calls process.exit with exitCode from signal", async () => {
      mockReadSignals.mockReturnValue({ exitCode: 5 });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(5)");
      expect(exitSpy).toHaveBeenCalledWith(5);
    });

    it("calls getExitCodeMessage when exitCode signal is present", async () => {
      mockReadSignals.mockReturnValue({ exitCode: 3 });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockGetExitCodeMessage).toHaveBeenCalledWith(3);
    });

    it("calls process.exit(0) with returnValue signal (just logs, no special exit)", async () => {
      mockReadSignals.mockReturnValue({ returnValue: "some return value" });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("abort due to errors", () => {
    it("calls process.exit(1) when session loop aborts due to errors", async () => {
      mockRunSessionLoop.mockImplementation(
        async (_prompt: string, opts: any) => {
          opts.onUnrecoverableAbort();
          return { outputText: "" };
        },
      );

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("pre and post hooks", () => {
    it("runs pre hooks when configured", async () => {
      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        hooks: { pre: [{ type: "command", command: "echo pre" }] },
      });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockRunHooks).toHaveBeenCalledWith(
        [{ type: "command", command: "echo pre" }],
        "pre",
        expect.any(Object),
      );
    });

    it("runs post hooks when configured", async () => {
      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        hooks: { post: [{ type: "command", command: "echo post" }] },
      });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      expect(mockRunHooks).toHaveBeenCalledWith(
        [{ type: "command", command: "echo post" }],
        "post",
        expect.any(Object),
      );
    });

    it("does not fail when post hooks throw", async () => {
      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        hooks: { post: [{ type: "command", command: "false" }] },
      });
      mockRunHooks.mockRejectedValue(new Error("post hook failed"));

      // Should still exit 0 despite hook failure
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("missing provider key", () => {
    it("throws missing provider API key when credentials dir has no key", async () => {
      // Create a creds dir with NO anthropic key
      const emptyCredDir = mkdtempSync(join(tmpdir(), "al-empty-creds-"));
      process.env.AL_CREDENTIALS_PATH = emptyCredDir;

      try {
        await expect(execute("dev", { project: projectPath })).rejects.toThrow(
          "missing provider API key credentials",
        );
      } finally {
        rmSync(emptyCredDir, { recursive: true, force: true });
      }
    });

    it("does not throw when model uses pi_auth (no API key needed)", async () => {
      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "pi_auth" as const }],
      });

      // pi_auth doesn't need a key from credentials dir
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("credentials loading from AL_CREDENTIALS_PATH", () => {
    it("reads provider token from credentials directory structure", async () => {
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");

      // The session loop should be called with a map containing the api key
      const callArgs = mockRunSessionLoop.mock.calls[0][1];
      expect(callArgs.providerKeys.get("anthropic")).toBe("test-api-key-12345");
    });

    it("sets GITHUB_TOKEN env var when github_token credential is present", async () => {
      // Create a creds dir with github token AND anthropic key
      const dir = mkdtempSync(join(tmpdir(), "al-creds-gh-"));
      mkdirSync(join(dir, "anthropic_key", "default"), { recursive: true });
      writeFileSync(join(dir, "anthropic_key", "default", "token"), "test-anthropic-key");
      mkdirSync(join(dir, "github_token", "default"), { recursive: true });
      writeFileSync(join(dir, "github_token", "default", "token"), "ghp_testtoken");
      process.env.AL_CREDENTIALS_PATH = dir;

      const origGhToken = process.env.GITHUB_TOKEN;
      const origGhCliToken = process.env.GH_TOKEN;

      try {
        await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");
        // After execution, GITHUB_TOKEN should be set
        expect(process.env.GITHUB_TOKEN || process.env.GH_TOKEN).toBeDefined();
      } finally {
        process.env.GITHUB_TOKEN = origGhToken;
        process.env.GH_TOKEN = origGhCliToken;
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("timeout configuration", () => {
    it("uses agent timeout when configured", async () => {
      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        timeout: 300,
      });

      // Should complete without issues (timer is unref'd)
      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
    });

    it("falls back to DEFAULT_AGENT_TIMEOUT when not configured", async () => {
      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        timeout: undefined,
      });
      mockLoadGlobalConfig.mockReturnValue({});

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
    });
  });

  describe("gateway health check", () => {
    it("polls the gateway health endpoint when GATEWAY_URL is set", async () => {
      process.env.GATEWAY_URL = "http://localhost:19999";

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      try {
        await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:19999/health",
          expect.objectContaining({ signal: expect.anything() }),
        );
      } finally {
        vi.unstubAllGlobals();
        delete process.env.GATEWAY_URL;
      }
    });

    it("continues after all retries if gateway remains unreachable", async () => {
      process.env.GATEWAY_URL = "http://localhost:19999";

      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);

      // Mock setTimeout to resolve immediately so we don't wait 500ms * 30
      const origSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any, _delay?: any, ..._args: any[]) => {
        if (_delay === 500) {
          // Immediately call the retry timeout, but only run a few retries
          fn();
          return 0 as any;
        }
        return origSetTimeout(fn, _delay, ..._args);
      });

      try {
        await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      } finally {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete process.env.GATEWAY_URL;
        // Re-apply the exit spy since restoreAllMocks cleared it
        exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: any): never => {
          throw new Error(`process.exit(${_code})`);
        });
        chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
      }
    });
  });

  describe("SSH key setup in credentials", () => {
    it("configures GIT_SSH_COMMAND when git_ssh credential is present with id_rsa", async () => {
      // Create a creds dir with anthropic key + git_ssh key
      const dir = mkdtempSync(join(tmpdir(), "al-creds-ssh-"));
      mkdirSync(join(dir, "anthropic_key", "default"), { recursive: true });
      writeFileSync(join(dir, "anthropic_key", "default", "token"), "test-anthropic-key");
      mkdirSync(join(dir, "git_ssh", "default"), { recursive: true });
      writeFileSync(join(dir, "git_ssh", "default", "id_rsa"), "-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----");
      writeFileSync(join(dir, "git_ssh", "default", "username"), "testuser");
      writeFileSync(join(dir, "git_ssh", "default", "email"), "test@example.com");
      process.env.AL_CREDENTIALS_PATH = dir;
      process.env.AL_WORK_DIR = workDir;

      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        credentials: ["github_token", "git_ssh"],
      });

      const origGitSsh = process.env.GIT_SSH_COMMAND;
      const origAuthorName = process.env.GIT_AUTHOR_NAME;
      const origAuthorEmail = process.env.GIT_AUTHOR_EMAIL;

      try {
        await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit");
        // SSH command should be configured
        expect(process.env.GIT_SSH_COMMAND).toContain("ssh -i");
        expect(process.env.GIT_AUTHOR_NAME).toBe("testuser");
        expect(process.env.GIT_AUTHOR_EMAIL).toBe("test@example.com");
      } finally {
        process.env.GIT_SSH_COMMAND = origGitSsh;
        process.env.GIT_AUTHOR_NAME = origAuthorName;
        process.env.GIT_AUTHOR_EMAIL = origAuthorEmail;
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("loadCredentialsFromPath edge cases", () => {
    it("skips non-directory entries at the credential type level", async () => {
      // Create a creds dir with a FILE at the type level (should be skipped)
      const dir = mkdtempSync(join(tmpdir(), "al-creds-file-"));
      mkdirSync(join(dir, "anthropic_key", "default"), { recursive: true });
      writeFileSync(join(dir, "anthropic_key", "default", "token"), "test-key");
      // Add a regular file (not directory) at the type level
      writeFileSync(join(dir, "README.txt"), "This is a file, not a dir");
      process.env.AL_CREDENTIALS_PATH = dir;

      try {
        // Should succeed (README.txt is skipped)
        await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("skips non-directory entries at the credential instance level", async () => {
      // Create a creds dir with a FILE at the instance level
      const dir = mkdtempSync(join(tmpdir(), "al-creds-inst-"));
      mkdirSync(join(dir, "anthropic_key", "default"), { recursive: true });
      writeFileSync(join(dir, "anthropic_key", "default", "token"), "test-key");
      // Add a regular file (not directory) at the instance level
      writeFileSync(join(dir, "anthropic_key", "some-file.txt"), "not a dir");
      process.env.AL_CREDENTIALS_PATH = dir;

      try {
        // Should succeed (some-file.txt is skipped)
        await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("duplicate provider model handling", () => {
    it("skips loading key for same provider when already loaded", async () => {
      // Two models with the same provider — second should be skipped
      mockLoadAgentConfig.mockReturnValue({
        ...defaultAgentConfig(),
        models: [
          { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const },
          { provider: "anthropic", model: "claude-haiku-3-5-20241022", authType: "api_key" as const },
        ],
      });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");

      // Session loop should still be called with the anthropic key
      const callArgs = mockRunSessionLoop.mock.calls[0][1];
      expect(callArgs.providerKeys.get("anthropic")).toBe("test-api-key-12345");
    });
  });

  describe("agentsFilesOverride callback", () => {
    it("calls agentsFilesOverride to build SKILL.md content for the session", async () => {
      mockLoadAgentBody.mockReturnValue("Custom skill content for testing");

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");

      // The session loop should receive processedBody via the override
      expect(mockProcessContextInjection).toHaveBeenCalledWith(
        "Custom skill content for testing",
        expect.any(Object),
      );
    });
  });

  describe("allModelsExhausted exit", () => {
    it("calls process.exit(12) when all models are exhausted", async () => {
      mockRunSessionLoop.mockResolvedValue({
        outputText: "",
        allModelsExhausted: true,
      });

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(12)");
      expect(exitSpy).toHaveBeenCalledWith(12);
    });

    it("does not call process.exit(12) when allModelsExhausted is false", async () => {
      mockRunSessionLoop.mockResolvedValue({
        outputText: "done",
        allModelsExhausted: false,
      });
      mockReadSignals.mockReturnValue({});

      await expect(execute("dev", { project: projectPath })).rejects.toThrow("process.exit(0)");
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(exitSpy).not.toHaveBeenCalledWith(12);
    });
  });
});
