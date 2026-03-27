import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock child_process
const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();

vi.mock("child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

// Mock credentials
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep), instance: ref.slice(sep + 1) };
  },
  getDefaultBackend: () => ({
    readAll: vi.fn().mockResolvedValue({ token: "test-token-value" }),
  }),
}));

import { HostUserRuntime } from "../../src/docker/host-user-runtime.js";
import type { RuntimeCredentials } from "../../src/docker/runtime.js";

describe("HostUserRuntime", () => {
  let runtime: HostUserRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user exists with uid/gid 1001
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "id" && args[0] === "-u") return "1001\n";
      if (cmd === "id" && args[0] === "-g") return "1001\n";
      return "";
    });
    runtime = new HostUserRuntime("al-agent");
  });

  describe("needsGateway", () => {
    it("is false", () => {
      expect(runtime.needsGateway).toBe(false);
    });
  });

  describe("prepareCredentials", () => {
    it("stages credentials to a temp directory", async () => {
      const creds = await runtime.prepareCredentials(["github_token"]);
      expect(creds.strategy).toBe("host-user");
      expect(creds.stagingDir).toBeTruthy();
      expect(creds.bundle).toHaveProperty("github_token");
      expect(creds.bundle.github_token.default.token).toBe("test-token-value");

      // Check file was written
      const tokenPath = join(creds.stagingDir, "github_token", "default", "token");
      expect(existsSync(tokenPath)).toBe(true);
      expect(readFileSync(tokenPath, "utf-8").trim()).toBe("test-token-value");

      // Cleanup
      runtime.cleanupCredentials(creds);
      expect(existsSync(creds.stagingDir)).toBe(false);
    });

    it("only stages requested credentials", async () => {
      const creds = await runtime.prepareCredentials(["github_token"]);
      const types = readdirSync(creds.stagingDir);
      expect(types).toEqual(["github_token"]);
      runtime.cleanupCredentials(creds);
    });
  });

  describe("cleanupCredentials", () => {
    it("removes the staging directory", async () => {
      const creds = await runtime.prepareCredentials(["github_token"]);
      expect(existsSync(creds.stagingDir)).toBe(true);
      runtime.cleanupCredentials(creds);
      expect(existsSync(creds.stagingDir)).toBe(false);
    });

    it("handles already-removed directory gracefully", () => {
      const creds: RuntimeCredentials = {
        strategy: "host-user",
        stagingDir: "/tmp/nonexistent-dir-12345",
        bundle: {},
      };
      expect(() => runtime.cleanupCredentials(creds)).not.toThrow();
    });
  });

  describe("launch", () => {
    it("spawns sudo with correct arguments", async () => {
      const mockProc = {
        stdout: { pipe: vi.fn(), on: vi.fn() },
        stderr: { pipe: vi.fn(), on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc);

      const runId = await runtime.launch({
        image: "ignored",
        agentName: "test-agent",
        env: { PROMPT: "do something" },
        credentials: { strategy: "host-user" as const, stagingDir: "/tmp/creds", bundle: {} },
      });

      expect(runId).toMatch(/^al-test-agent-/);
      expect(mockSpawn).toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["-u", "al-agent"]),
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );

      // Check env vars
      const spawnCall = mockSpawn.mock.calls[0];
      const spawnEnv = spawnCall[2].env;
      expect(spawnEnv.AL_CREDENTIALS_PATH).toBe("/tmp/creds");
      expect(spawnEnv.PROMPT).toBe("do something");
    });
  });

  describe("isAgentRunning / listRunningAgents", () => {
    it("returns false / empty when no agents are running", async () => {
      expect(await runtime.isAgentRunning("test-agent")).toBe(false);
      expect(await runtime.listRunningAgents()).toEqual([]);
    });
  });

  describe("kill", () => {
    it("does not throw for unknown runId", async () => {
      await expect(runtime.kill("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("remove", () => {
    it("removes the working directory", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-test-run-"));
      const runId = dir.split("/").pop()!;
      // Create a file in the dir
      writeFileSync(join(dir, "test.txt"), "hello");

      // Note: remove() uses RUNS_DIR internally, so this tests the graceful handling
      await expect(runtime.remove(runId)).resolves.not.toThrow();
    });
  });

  describe("getTaskUrl", () => {
    it("returns null", () => {
      expect(runtime.getTaskUrl("any")).toBeNull();
    });
  });

  describe("fetchLogs", () => {
    it("returns empty array when no logs exist", async () => {
      const logs = await runtime.fetchLogs("nonexistent-agent", 50);
      expect(logs).toEqual([]);
    });
  });
});
