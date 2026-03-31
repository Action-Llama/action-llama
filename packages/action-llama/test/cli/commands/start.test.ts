import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Mock environment resolution
vi.mock("../../../src/shared/environment.js", async () => {
  const actual = await vi.importActual("../../../src/shared/environment.js") as any;
  return {
    ...actual,
    resolveEnvironmentName: vi.fn().mockReturnValue(undefined),
    loadEnvironmentConfig: vi.fn().mockReturnValue({}),
  };
});

// Mock SSH
vi.mock("../../../src/remote/ssh.js", () => ({
  sshOptionsFromConfig: vi.fn().mockReturnValue({ host: "10.0.0.1", user: "root", port: 22 }),
  sshExec: vi.fn().mockResolvedValue(""),
}));

// Mock gateway client
vi.mock("../../../src/cli/gateway-client.js", () => ({
  gatewayFetch: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
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
import { resolveEnvironmentName, loadEnvironmentConfig } from "../../../src/shared/environment.js";
import { sshExec } from "../../../src/remote/ssh.js";
import { gatewayFetch } from "../../../src/cli/gateway-client.js";
import { credentialExists } from "../../../src/shared/credentials.js";
import { attachPlainLogger } from "../../../src/tui/plain-logger.js";
import { loadGlobalConfig } from "../../../src/shared/config.js";

describe("start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no environment (local mode)
    vi.mocked(resolveEnvironmentName).mockReturnValue(undefined);
    vi.mocked(gatewayFetch).mockRejectedValue(new Error("ECONNREFUSED"));
    vi.mocked(credentialExists).mockResolvedValue(true);
    vi.mocked(loadGlobalConfig).mockReturnValue({});
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

  describe("remote server start", () => {
    beforeEach(() => {
      vi.mocked(resolveEnvironmentName).mockReturnValue("prod");
      vi.mocked(loadEnvironmentConfig).mockReturnValue({
        server: { host: "10.0.0.1" },
      });
    });

    it("prints already running when health check passes", async () => {
      vi.mocked(gatewayFetch).mockResolvedValue({ ok: true } as Response);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await execute({ project: "/tmp/test", env: "prod" });

      expect(spy).toHaveBeenCalledWith(expect.stringContaining("already running"));
      expect(sshExec).not.toHaveBeenCalled();
      expect(startScheduler).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("starts remote service via SSH and polls health", async () => {
      // First gatewayFetch (initial health check) fails, then succeeds after SSH start
      vi.mocked(gatewayFetch)
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValue({ ok: true } as Response);
      vi.mocked(sshExec).mockResolvedValue("");
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await execute({ project: "/tmp/test", env: "prod" });

      expect(sshExec).toHaveBeenCalledWith(
        expect.objectContaining({ host: "10.0.0.1" }),
        "sudo systemctl start action-llama",
      );
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Service started"));
      expect(startScheduler).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("throws with push hint when SSH fails", async () => {
      vi.mocked(gatewayFetch).mockRejectedValue(new Error("ECONNREFUSED"));
      vi.mocked(sshExec).mockRejectedValue(new Error("Connection refused"));

      await expect(execute({ project: "/tmp/test", env: "prod" })).rejects.toThrow(
        /al push/,
      );
      expect(startScheduler).not.toHaveBeenCalled();
    });

    it("warns on health timeout after successful SSH start", async () => {
      // gatewayFetch always fails (health never comes up)
      vi.mocked(gatewayFetch).mockRejectedValue(new Error("ECONNREFUSED"));
      vi.mocked(sshExec).mockResolvedValue("");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Override the 30s timeout — we don't want to wait in tests.
      // We'll use vi.useFakeTimers to speed through the polling.
      vi.useFakeTimers();

      const promise = execute({ project: "/tmp/test", env: "prod" });

      // Advance past the 30s deadline + all poll intervals
      await vi.advanceTimersByTimeAsync(35_000);

      await promise;

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("did not respond within 30s"));
      expect(startScheduler).not.toHaveBeenCalled();

      warnSpy.mockRestore();
      logSpy.mockRestore();
      vi.useRealTimers();
    });
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

  // ── Poll healthy=true ─────────────────────────────────────────────────────

  describe("remote server start — healthy poll path", () => {
    beforeEach(() => {
      vi.mocked(resolveEnvironmentName).mockReturnValue("staging");
      vi.mocked(loadEnvironmentConfig).mockReturnValue({
        server: { host: "192.168.1.100" },
      });
    });

    it("sets healthy=true and logs 'Service started' when poll succeeds", async () => {
      vi.useFakeTimers();

      // Initial health check → not running; SSH start succeeds; poll → healthy
      vi.mocked(gatewayFetch)
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValue({ ok: true } as Response);
      vi.mocked(sshExec).mockResolvedValue("");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const promise = execute({ project: "/tmp/test", env: "staging" });

      // Advance timers past the 2s poll interval so the poll fires and health check succeeds
      await vi.advanceTimersByTimeAsync(3_000);

      await promise;

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Service started"));
      logSpy.mockRestore();
      vi.useRealTimers();
    });
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
