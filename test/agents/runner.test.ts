import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock dependencies
vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn((provider: string, model: string) => ({ provider, model })),
}));

const mockSubscribe = vi.fn();
const mockPrompt = vi.fn();
const mockDispose = vi.fn();
const mockGetSessionStats = vi.fn();
vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
  createAgentSession: vi.fn(() =>
    Promise.resolve({
      session: {
        subscribe: mockSubscribe,
        prompt: mockPrompt,
        dispose: mockDispose,
        getSessionStats: mockGetSessionStats,
      },
    })
  ),
  DefaultResourceLoader: class {
    constructor(_opts: any) {}
    reload() { return Promise.resolve(); }
  },
  SessionManager: { inMemory: () => ({}) },
  SettingsManager: { inMemory: (opts: any) => opts },
  createCodingTools: vi.fn(() => []),
}));

vi.mock("../../src/shared/credentials.js", () => ({
  loadCredentialField: () => "fake-key",
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  resolveAgentCredentials: (_agentName: string, refs: string[]) => {
    return Promise.resolve(refs.map((ref: string) => {
      const sep = ref.indexOf(":");
      if (sep === -1) return { type: ref, instance: "default" };
      return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
    }));
  },
  requireCredentialRef: () => {},
  writeCredentialField: () => {},
  writeCredentialFields: () => {},
  credentialExists: () => true,
  backendLoadField: () => Promise.resolve("fake-key"),
  backendLoadFields: () => Promise.resolve({}),
  backendCredentialExists: () => Promise.resolve(true),
  backendListInstances: () => Promise.resolve([]),
  backendRequireCredentialRef: () => Promise.resolve(),
  getDefaultBackend: () => {},
  setDefaultBackend: () => {},
  resetDefaultBackend: () => {},
}));

import { AgentRunner } from "../../src/agents/runner.js";
import pino from "pino";
import { makeAgentConfig as makeAgentConfigBase } from "../helpers.js";
import type { AgentConfig } from "../../src/shared/config.js";

function makeRunnerAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return makeAgentConfigBase({
    name: "dev",
    params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
    ...overrides,
  });
}

function makeLogger(): pino.Logger {
  return pino({ level: "silent" });
}

describe("AgentRunner", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-runner-"));
    // Create needed directories
    mkdirSync(resolve(tmpDir, "agents", "dev"), { recursive: true });
    mkdirSync(resolve(tmpDir, ".al", "logs"), { recursive: true });
    // Write ACTIONS.md (required on disk now)
    writeFileSync(resolve(tmpDir, "agents", "dev", "ACTIONS.md"), "# Dev Agent\nDefault instructions.");
    
    // Configure session stats mock with realistic data
    mockGetSessionStats.mockReturnValue({
      usage: {
        input: 100,
        output: 200,
        cacheRead: 50,
        cacheWrite: 25,
        totalTokens: 375,
        cost: { input: 0.001, output: 0.002, cacheRead: 0.0005, cacheWrite: 0.00025, total: 0.00375 }
      },
      turnCount: 3
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates runner and reports not running initially", () => {
    const runner = new AgentRunner(makeRunnerAgentConfig(), makeLogger(), tmpDir);
    expect(runner.isRunning).toBe(false);
  });

  it("runs agent session and calls prompt", async () => {
    const runner = new AgentRunner(makeRunnerAgentConfig(), makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);

    // Mock subscribe to simulate text output
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "done" },
      });
    });

    // Scheduler now pre-builds the prompt; runner passes it through directly
    await runner.run("<agent-config>\n{}\n</agent-config>\n\nTest prompt");
    expect(mockPrompt).toHaveBeenCalledWith(expect.stringContaining("<agent-config>"));
    expect(mockDispose).toHaveBeenCalled();
    expect(runner.isRunning).toBe(false);
  });

  it("skips if already running", async () => {
    const logger = makeLogger();
    const warnSpy = vi.spyOn(logger, "warn");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);

    // Simulate a long-running prompt
    let resolvePrompt: () => void;
    mockPrompt.mockImplementation(
      () => new Promise<void>((r) => (resolvePrompt = r))
    );
    mockSubscribe.mockImplementation(() => {});

    const firstRun = runner.run("First");
    await new Promise((r) => setTimeout(r, 10));
    expect(runner.isRunning).toBe(true);

    // Second run should be skipped
    await runner.run("Second");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already running"));

    // Clean up
    resolvePrompt!();
    await firstRun;
  });

  it("handles errors gracefully", async () => {
    const logger = makeLogger();
    const errorSpy = vi.spyOn(logger, "error");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);
    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockRejectedValue(new Error("Session failed"));

    await runner.run("Test");
    expect(errorSpy).toHaveBeenCalled();
    expect(runner.isRunning).toBe(false);
  });

  it("detects RERUN signal from signal file", async () => {
    const logger = makeLogger();
    const infoSpy = vi.spyOn(logger, "info");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);

    mockSubscribe.mockImplementation(() => {});
    // Simulate al-rerun by writing the signal file during prompt execution
    mockPrompt.mockImplementation(async () => {
      const signalDir = process.env.AL_SIGNAL_DIR;
      if (signalDir) {
        writeFileSync(join(signalDir, "rerun"), "");
      }
    });

    const outcome = await runner.run("Test");
    expect(outcome.result).toBe("rerun");
    expect(infoSpy).toHaveBeenCalledWith(expect.anything(), "run completed, rerun requested");
  });

  it("returns empty triggers (triggers handled by al-call)", async () => {
    const runner = new AgentRunner(makeRunnerAgentConfig(), makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    const outcome = await runner.run("Test");
    expect(outcome.triggers).toEqual([]);
  });

  it("logs bash commands", async () => {
    const logger = makeLogger();
    const infoSpy = vi.spyOn(logger, "info");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call-1",
        args: { command: "gh issue list --repo acme/app" },
      });
      callback({
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "call-1",
        result: '[]',
        isError: false,
      });
    });

    await runner.run("Test");
    expect(infoSpy).toHaveBeenCalledWith(
      { cmd: "gh issue list --repo acme/app" },
      "bash"
    );
  });

  it("truncates long bash commands", async () => {
    const logger = makeLogger();
    const infoSpy = vi.spyOn(logger, "info");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);
    mockPrompt.mockResolvedValue(undefined);

    const longCmd = "cat " + "x".repeat(500);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call-2",
        args: { command: longCmd },
      });
      callback({
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "call-2",
        result: "output",
        isError: false,
      });
    });

    await runner.run("Test");
    // Should truncate the command
    expect(infoSpy).toHaveBeenCalledWith(
      { cmd: longCmd.slice(0, 200) },
      "bash"
    );
  });

  it("logs tool errors", async () => {
    const logger = makeLogger();
    const errorSpy = vi.spyOn(logger, "error");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "call-3",
        result: "Command not found",
        isError: true,
      });
    });

    await runner.run("Test");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "bash", result: "Command not found" }),
      "tool error"
    );
  });

  it("logs non-bash tool events at debug level", async () => {
    const logger = makeLogger();
    const debugSpy = vi.spyOn(logger, "debug");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "call-4",
        args: { path: "/tmp/file.txt" },
      });
      callback({
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "call-4",
        result: "file contents",
        isError: false,
      });
    });

    await runner.run("Test");
    expect(debugSpy).toHaveBeenCalledWith({ tool: "read" }, "tool start");
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "read", resultLength: 13 }),
      "tool done"
    );
  });

  it("throws when ACTIONS.md is missing", async () => {
    // Create a separate agent dir without ACTIONS.md
    const noMdDir = mkdtempSync(join(tmpdir(), "al-runner-nomd-"));
    mkdirSync(resolve(noMdDir, "agents", "dev"), { recursive: true });
    mkdirSync(resolve(noMdDir, ".al", "logs"), { recursive: true });
    // No ACTIONS.md written

    const logger = makeLogger();
    const errorSpy = vi.spyOn(logger, "error");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, noMdDir);
    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockResolvedValue(undefined);

    await runner.run("Test");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: expect.stringContaining("ACTIONS.md not found") }) }),
      expect.any(String)
    );

    rmSync(noMdDir, { recursive: true, force: true });
  });

  it("reads ACTIONS.md from disk", async () => {
    const runner = new AgentRunner(makeRunnerAgentConfig(), makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("uses custom ACTIONS.md when present", async () => {
    // Overwrite with a custom ACTIONS.md
    writeFileSync(resolve(tmpDir, "agents", "dev", "ACTIONS.md"), "# Custom Agent\nDo custom things.");

    const runner = new AgentRunner(makeRunnerAgentConfig(), makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("uses pi_auth when configured", async () => {
    const agentConfig = makeRunnerAgentConfig({
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        thinkingLevel: "medium",
        authType: "pi_auth",
      },
    });
    const runner = new AgentRunner(agentConfig, makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("works with openai provider and api_key auth", async () => {
    const agentConfig = makeRunnerAgentConfig({
      model: {
        provider: "openai",
        model: "gpt-4",
        thinkingLevel: "medium",
        authType: "api_key",
      },
    });
    const runner = new AgentRunner(agentConfig, makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("works with openai codex model", async () => {
    const agentConfig = makeRunnerAgentConfig({
      model: {
        provider: "openai",
        model: "gpt-4o",
        thinkingLevel: "low",
        authType: "api_key",
      },
    });
    const runner = new AgentRunner(agentConfig, makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("supports arbitrary LLM providers", async () => {
    const logger = makeLogger();
    const debugSpy = vi.spyOn(logger, "debug");
    
    const agentConfig = makeRunnerAgentConfig({
      model: {
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        thinkingLevel: "medium",
        authType: "api_key",
      },
    });
    const runner = new AgentRunner(agentConfig, logger, tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    // Should successfully load groq_key credential and run without warnings
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Loaded groq_key credential for groq"));
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("detects EXIT signal from signal file with code", async () => {
    const logger = makeLogger();
    const errorSpy = vi.spyOn(logger, "error");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);

    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockImplementation(async () => {
      const signalDir = process.env.AL_SIGNAL_DIR;
      if (signalDir) {
        writeFileSync(join(signalDir, "exit"), "10");
      }
    });

    const outcome = await runner.run("Test");
    expect(outcome.result).toBe("error");
    expect(outcome.exitCode).toBe(10);
    expect(outcome.exitReason).toBe("Authentication/credentials failure");
    expect(errorSpy).toHaveBeenCalledWith(
      { exitCode: 10, reason: "Authentication/credentials failure" },
      "agent terminated with exit signal"
    );
  });

  it("detects EXIT signal with default code 15", async () => {
    const logger = makeLogger();
    const errorSpy = vi.spyOn(logger, "error");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);

    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockImplementation(async () => {
      const signalDir = process.env.AL_SIGNAL_DIR;
      if (signalDir) {
        writeFileSync(join(signalDir, "exit"), "15");
      }
    });

    const outcome = await runner.run("Test");
    expect(outcome.result).toBe("error");
    expect(outcome.exitCode).toBe(15);
    expect(outcome.exitReason).toBe("Unrecoverable error");
    expect(errorSpy).toHaveBeenCalledWith(
      { exitCode: 15, reason: "Unrecoverable error" },
      "agent terminated with exit signal"
    );
  });

  it("completes normally when no signal files written", async () => {
    const logger = makeLogger();
    const infoSpy = vi.spyOn(logger, "info");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    const outcome = await runner.run("Test");
    expect(outcome.result).toBe("completed");
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.exitReason).toBeUndefined();
    expect(infoSpy).toHaveBeenCalledWith(expect.anything(), "run completed");
  });

  it("prioritizes EXIT over RERUN", async () => {
    const logger = makeLogger();
    const errorSpy = vi.spyOn(logger, "error");
    const runner = new AgentRunner(makeRunnerAgentConfig(), logger, tmpDir);

    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockImplementation(async () => {
      const signalDir = process.env.AL_SIGNAL_DIR;
      if (signalDir) {
        writeFileSync(join(signalDir, "exit"), "11");
        writeFileSync(join(signalDir, "rerun"), "");
      }
    });

    const outcome = await runner.run("Test");
    expect(outcome.result).toBe("error");
    expect(outcome.exitCode).toBe(11);
    expect(outcome.exitReason).toBe("Permission/access denied");
    expect(errorSpy).toHaveBeenCalledWith(
      { exitCode: 11, reason: "Permission/access denied" },
      "agent terminated with exit signal"
    );
  });

  it("reads return value from signal file", async () => {
    const runner = new AgentRunner(makeRunnerAgentConfig(), makeLogger(), tmpDir);

    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockImplementation(async () => {
      const signalDir = process.env.AL_SIGNAL_DIR;
      if (signalDir) {
        writeFileSync(join(signalDir, "return"), "PR review result");
      }
    });

    const outcome = await runner.run("Test");
    expect(outcome.result).toBe("completed");
    expect(outcome.returnValue).toBe("PR review result");
  });

  it("cleans up signal dir and restores PATH after run", async () => {
    const runner = new AgentRunner(makeRunnerAgentConfig(), makeLogger(), tmpDir);
    const originalPath = process.env.PATH;
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(process.env.AL_SIGNAL_DIR).toBeUndefined();
    expect(process.env.PATH).toBe(originalPath);
  });
});
