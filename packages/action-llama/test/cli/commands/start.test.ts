import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config to return a minimal global config
vi.mock("../../../src/shared/config.js", async () => {
  const actual = await vi.importActual("../../../src/shared/config.js") as any;
  return {
    ...actual,
    loadGlobalConfig: vi.fn().mockReturnValue({}),
  };
});

// Mock doctor to be a no-op
vi.mock("../../../src/cli/commands/doctor.js", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

// Mock the scheduler to not actually start
vi.mock("../../../src/scheduler/index.js", () => ({
  startScheduler: vi.fn().mockResolvedValue({
    cronJobs: [1, 2, 3],
    runners: {},
  }),
}));

// Mock TUI render to avoid React dependency in unit tests
vi.mock("../../../src/tui/render.js", () => ({
  renderTUI: vi.fn().mockResolvedValue({ unmount: vi.fn() }),
}));

// Mock credentials
vi.mock("../../../src/shared/credentials.js", () => ({
  credentialExists: vi.fn().mockResolvedValue(true),
}));

// Mock plain-logger for headless mode
vi.mock("../../../src/tui/plain-logger.js", () => ({
  attachPlainLogger: vi.fn().mockReturnValue({ detach: vi.fn() }),
}));

import { execute } from "../../../src/cli/commands/start.js";
import { startScheduler } from "../../../src/scheduler/index.js";
import { StatusTracker } from "../../../src/tui/status-tracker.js";
import { credentialExists } from "../../../src/shared/credentials.js";
import { attachPlainLogger } from "../../../src/tui/plain-logger.js";
import { loadGlobalConfig } from "../../../src/shared/config.js";

describe("start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(credentialExists).mockResolvedValue(true);
    vi.mocked(loadGlobalConfig).mockReturnValue({});
  });

  afterEach(() => {
    // Clean up SIGINT/SIGTERM handlers registered by execute() to prevent
    // state leaking between tests.
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });

  it("calls startScheduler with StatusTracker and renders TUI", async () => {
    const promise = execute({ project: "/tmp/test" });

    // Give it a tick to start
    await new Promise((r) => setTimeout(r, 50));

    expect(startScheduler).toHaveBeenCalledWith(
      expect.stringContaining("test"),
      expect.any(Object),
      expect.any(StatusTracker),
      undefined,
      undefined
    );

    // We can't await the promise since it never resolves, so just verify it started
  });

  // ── SKILL.md guard ──────────────────────────────────────────────────────

  it("throws when SKILL.md exists in project directory (agent directory guard)", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tmpDir = mkdtempSync(join(tmpdir(), "al-start-skill-"));
    writeFileSync(join(tmpDir, "SKILL.md"), "# Agent skill");

    try {
      await expect(execute({ project: tmpDir })).rejects.toThrow(
        /looks like an agent directory/,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Security validation: webUi/expose without API key ────────────────────

  it("throws ConfigError when --web-ui is used without a gateway API key", async () => {
    vi.mocked(credentialExists).mockResolvedValue(false);

    const { ConfigError } = await import("../../../src/shared/errors.js");
    await expect(execute({ project: "/tmp/test", webUi: true })).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError when --expose is used without a gateway API key", async () => {
    vi.mocked(credentialExists).mockResolvedValue(false);

    const { ConfigError } = await import("../../../src/shared/errors.js");
    await expect(execute({ project: "/tmp/test", expose: true })).rejects.toThrow(ConfigError);
  });

  // ── Port override ────────────────────────────────────────────────────────

  it("applies port override from opts.port when no gateway config exists", async () => {
    vi.mocked(loadGlobalConfig).mockReturnValue({});

    const promise = execute({ project: "/tmp/test", port: 9090 });
    await new Promise((r) => setTimeout(r, 50));

    expect(startScheduler).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ gateway: expect.objectContaining({ port: 9090 }) }),
      expect.any(StatusTracker),
      undefined,
      undefined
    );
    // Don't await promise — it hangs forever
  });

  it("applies port override from opts.port when gateway config already exists", async () => {
    vi.mocked(loadGlobalConfig).mockReturnValue({ gateway: { port: 8080 } });

    const promise = execute({ project: "/tmp/test", port: 7777 });
    await new Promise((r) => setTimeout(r, 50));

    expect(startScheduler).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ gateway: expect.objectContaining({ port: 7777 }) }),
      expect.any(StatusTracker),
      undefined,
      undefined
    );
    // Don't await promise — it hangs forever
  });

  // ── Local config: enabled = true else branch ──────────────────────────────

  it("sets local.enabled = true when local config already exists", async () => {
    vi.mocked(loadGlobalConfig).mockReturnValue({ local: { enabled: false } });

    const promise = execute({ project: "/tmp/test" });
    await new Promise((r) => setTimeout(r, 50));

    expect(startScheduler).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ local: expect.objectContaining({ enabled: true }) }),
      expect.any(StatusTracker),
      undefined,
      undefined
    );
    // Don't await promise
  });

  // ── Headless mode ────────────────────────────────────────────────────────

  it("uses attachPlainLogger instead of renderTUI when headless=true", async () => {
    const promise = execute({ project: "/tmp/test", headless: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(attachPlainLogger).toHaveBeenCalledWith(expect.any(StatusTracker));
    // Don't await promise
  });

  it("shutdown: SIGINT handler calls cleanup and exits with code 0", async () => {
    // Capture the SIGINT handler registered by execute
    let capturedSigint: (() => void) | undefined;
    const origProcessOn = process.on.bind(process);
    const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: any, handler: any) => {
      if (event === "SIGINT" || event === "SIGTERM") {
        capturedSigint = handler;
      }
      // Pass through to real process.on so other listeners still work
      return origProcessOn(event, handler);
    });

    // Mock process.exit to prevent actual exit
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      const _promise = execute({ project: "/tmp/test" });

      // Allow execute to start and register SIGINT/SIGTERM handlers
      await new Promise((r) => setTimeout(r, 50));

      expect(capturedSigint).toBeDefined();

      // Calling the shutdown function should invoke cleanup() and process.exit(0)
      capturedSigint!();

      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
      // Remove the actual SIGINT listener we registered via passthrough
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
    }
  });
});
