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

import { execute } from "../../../src/cli/commands/start.js";
import { startScheduler } from "../../../src/scheduler/index.js";
import { StatusTracker } from "../../../src/tui/status-tracker.js";
import { resolveEnvironmentName, loadEnvironmentConfig } from "../../../src/shared/environment.js";
import { sshExec } from "../../../src/remote/ssh.js";
import { gatewayFetch } from "../../../src/cli/gateway-client.js";

describe("start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no environment (local mode)
    vi.mocked(resolveEnvironmentName).mockReturnValue(undefined);
    vi.mocked(gatewayFetch).mockRejectedValue(new Error("ECONNREFUSED"));
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
});
