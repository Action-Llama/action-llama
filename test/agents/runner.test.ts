import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock dependencies
vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({ provider: "anthropic", model: "test" })),
}));

const mockSubscribe = vi.fn();
const mockPrompt = vi.fn();
const mockDispose = vi.fn();
vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
  createAgentSession: vi.fn(() =>
    Promise.resolve({
      session: {
        subscribe: mockSubscribe,
        prompt: mockPrompt,
        dispose: mockDispose,
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
  loadCredential: () => "fake-key",
  requireCredential: () => "fake-key",
  writeCredential: () => {},
}));

import { AgentRunner } from "../../src/agents/runner.js";
import type { AgentConfig } from "../../src/shared/config.js";
import pino from "pino";

function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: "dev",
    credentials: ["github-token"],
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      thinkingLevel: "medium",
      authType: "api_key",
    },
    schedule: "*/5 * * * *",
    repos: ["acme/app"],
    params: { triggerLabel: "agent", assignee: "bot" },
    ...overrides,
  };
}

function makeLogger(): pino.Logger {
  // Silent logger for tests
  return pino({ level: "silent" });
}

describe("AgentRunner", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-runner-"));
    // Create needed directories
    mkdirSync(resolve(tmpDir, "dev"), { recursive: true });
    mkdirSync(resolve(tmpDir, ".al", "logs"), { recursive: true });
    // Write AGENTS.md (required on disk now)
    writeFileSync(resolve(tmpDir, "dev", "AGENTS.md"), "# Dev Agent\nDefault instructions.");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates runner and reports not running initially", () => {
    const runner = new AgentRunner(makeAgentConfig(), makeLogger(), tmpDir);
    expect(runner.isRunning).toBe(false);
  });

  it("runs agent session and calls prompt", async () => {
    const runner = new AgentRunner(makeAgentConfig(), makeLogger(), tmpDir);
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
    const runner = new AgentRunner(makeAgentConfig(), logger, tmpDir);

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
    const runner = new AgentRunner(makeAgentConfig(), logger, tmpDir);
    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockRejectedValue(new Error("Session failed"));

    await runner.run("Test");
    expect(errorSpy).toHaveBeenCalled();
    expect(runner.isRunning).toBe(false);
  });

  it("detects SILENT output", async () => {
    const logger = makeLogger();
    const infoSpy = vi.spyOn(logger, "info");
    const runner = new AgentRunner(makeAgentConfig(), logger, tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((callback: Function) => {
      callback({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "[SILENT]" },
      });
    });

    await runner.run("Test");
    expect(infoSpy).toHaveBeenCalledWith("no work to do");
  });

  it("logs bash commands", async () => {
    const logger = makeLogger();
    const infoSpy = vi.spyOn(logger, "info");
    const runner = new AgentRunner(makeAgentConfig(), logger, tmpDir);
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
    const runner = new AgentRunner(makeAgentConfig(), logger, tmpDir);
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
    const runner = new AgentRunner(makeAgentConfig(), logger, tmpDir);
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
    const runner = new AgentRunner(makeAgentConfig(), logger, tmpDir);
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

  it("throws when AGENTS.md is missing", async () => {
    // Create a separate agent dir without AGENTS.md
    const noMdDir = mkdtempSync(join(tmpdir(), "al-runner-nomd-"));
    mkdirSync(resolve(noMdDir, "dev"), { recursive: true });
    mkdirSync(resolve(noMdDir, ".al", "logs"), { recursive: true });
    // No AGENTS.md written

    const logger = makeLogger();
    const errorSpy = vi.spyOn(logger, "error");
    const runner = new AgentRunner(makeAgentConfig(), logger, noMdDir);
    mockSubscribe.mockImplementation(() => {});
    mockPrompt.mockResolvedValue(undefined);

    await runner.run("Test");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: expect.stringContaining("AGENTS.md not found") }) }),
      expect.any(String)
    );

    rmSync(noMdDir, { recursive: true, force: true });
  });

  it("reads AGENTS.md from disk", async () => {
    const runner = new AgentRunner(makeAgentConfig(), makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("uses custom AGENTS.md when present", async () => {
    // Overwrite with a custom AGENTS.md
    writeFileSync(resolve(tmpDir, "dev", "AGENTS.md"), "# Custom Agent\nDo custom things.");

    const runner = new AgentRunner(makeAgentConfig(), makeLogger(), tmpDir);
    mockPrompt.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation(() => {});

    await runner.run("Test");
    expect(mockPrompt).toHaveBeenCalled();
  });

  it("uses pi_auth when configured", async () => {
    const agentConfig = makeAgentConfig({
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
});
