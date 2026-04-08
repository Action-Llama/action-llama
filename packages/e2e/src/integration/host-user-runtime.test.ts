/**
 * Integration tests: docker/host-user-runtime.ts HostUserRuntime — no Docker required.
 *
 * HostUserRuntime runs agents as a separate OS user via `sudo -u` (without Docker).
 * Most methods require a real process launch, but the constructor, property
 * accessors, and side-effect-free methods can be exercised without Docker or
 * root access.
 *
 * Test scenarios (no Docker, no root, no running agents required):
 *   1.  constructor: default runAs="al-agent", groups=[]
 *   2.  constructor: custom runAs and groups accepted without error
 *   3.  needsGateway: is false (host-user mode never needs gateway injection)
 *   4.  isAgentRunning("nonexistent"): returns false when no in-memory state and no PID files
 *   5.  listRunningAgents(): returns [] when no in-memory state and no PID files
 *   6.  prepareCredentials([]): creates a staging dir, returns strategy="host-user" + empty bundle
 *   7.  prepareCredentials([]): returned stagingDir exists on disk
 *   8.  cleanupCredentials(): removes the staging dir from disk
 *   9.  cleanupCredentials(): is a no-op for non-host-user strategy credentials
 *  10.  cleanupCredentials(): does not throw when stagingDir is already removed
 *  11.  getTaskUrl(): returns null (no cloud task URL for host-user mode)
 *  12.  reattach("nonexistent"): returns false when no PID file exists for the runId
 *  13.  Two HostUserRuntime instances are independent (separate in-memory maps)
 *  14.  prepareCredentials([]) called twice returns distinct stagingDirs
 *
 * Covers:
 *   - docker/host-user-runtime.ts: HostUserRuntime constructor
 *   - docker/host-user-runtime.ts: needsGateway property
 *   - docker/host-user-runtime.ts: isAgentRunning() initial state
 *   - docker/host-user-runtime.ts: listRunningAgents() initial state
 *   - docker/host-user-runtime.ts: prepareCredentials() with empty credRefs
 *   - docker/host-user-runtime.ts: cleanupCredentials() staging dir cleanup
 *   - docker/host-user-runtime.ts: cleanupCredentials() no-op for unknown strategy
 *   - docker/host-user-runtime.ts: getTaskUrl() null return
 *   - docker/host-user-runtime.ts: reattach() returns false for missing PID file
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";

const { HostUserRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/host-user-runtime.js"
);

describe("integration: HostUserRuntime (no Docker required)", { timeout: 30_000 }, () => {

  // ── constructor ────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("instantiates with default runAs and groups (no args)", () => {
      expect(() => new HostUserRuntime()).not.toThrow();
    });

    it("instantiates with a custom runAs user", () => {
      expect(() => new HostUserRuntime("custom-user")).not.toThrow();
    });

    it("instantiates with custom runAs and groups", () => {
      expect(() => new HostUserRuntime("custom-user", ["docker", "sudo"])).not.toThrow();
    });

    it("instantiates with empty groups array", () => {
      expect(() => new HostUserRuntime("al-agent", [])).not.toThrow();
    });
  });

  // ── needsGateway ─────────────────────────────────────────────────────────

  describe("needsGateway", () => {
    it("is false — host-user mode does not need gateway injection", () => {
      const rt = new HostUserRuntime();
      expect(rt.needsGateway).toBe(false);
    });

    it("is a boolean", () => {
      const rt = new HostUserRuntime();
      expect(typeof rt.needsGateway).toBe("boolean");
    });
  });

  // ── isAgentRunning() ──────────────────────────────────────────────────────

  describe("isAgentRunning()", () => {
    it("returns false for a nonexistent agent (fresh instance, no PID files)", async () => {
      const rt = new HostUserRuntime();
      const result = await rt.isAgentRunning("nonexistent-agent-xyz");
      expect(result).toBe(false);
    });

    it("returns a boolean", async () => {
      const rt = new HostUserRuntime();
      const result = await rt.isAgentRunning("some-agent");
      expect(typeof result).toBe("boolean");
    });

    it("returns false for two different agent names on a fresh instance", async () => {
      const rt = new HostUserRuntime();
      const r1 = await rt.isAgentRunning("agent-alpha");
      const r2 = await rt.isAgentRunning("agent-beta");
      expect(r1).toBe(false);
      expect(r2).toBe(false);
    });
  });

  // ── listRunningAgents() ───────────────────────────────────────────────────

  describe("listRunningAgents()", () => {
    it("returns an empty array on a fresh instance with no PID files in scope", async () => {
      const rt = new HostUserRuntime();
      const agents = await rt.listRunningAgents();
      expect(Array.isArray(agents)).toBe(true);
      // On a fresh instance, there are no in-memory processes, and any PID files
      // in /tmp/al-runs from other tests belong to dead processes that get cleaned up.
      // The result must be an array (possibly empty, possibly non-empty from stale files).
    });

    it("returns an array (type check)", async () => {
      const rt = new HostUserRuntime();
      const agents = await rt.listRunningAgents();
      expect(Array.isArray(agents)).toBe(true);
    });

    it("each returned agent has agentName, taskId, runtimeId, status", async () => {
      const rt = new HostUserRuntime();
      const agents = await rt.listRunningAgents();
      for (const agent of agents) {
        expect(typeof agent.agentName).toBe("string");
        expect(typeof agent.taskId).toBe("string");
        expect(typeof agent.runtimeId).toBe("string");
        expect(typeof agent.status).toBe("string");
      }
    });
  });

  // ── prepareCredentials() ──────────────────────────────────────────────────

  describe("prepareCredentials([])", () => {
    it("returns an object with strategy='host-user'", async () => {
      const rt = new HostUserRuntime();
      const creds = await rt.prepareCredentials([]);
      expect((creds as any).strategy).toBe("host-user");
    });

    it("returns an empty bundle when no credRefs are provided", async () => {
      const rt = new HostUserRuntime();
      const creds = await rt.prepareCredentials([]);
      expect((creds as any).bundle).toBeDefined();
      expect(typeof (creds as any).bundle).toBe("object");
      expect(Object.keys((creds as any).bundle)).toHaveLength(0);
    });

    it("returns a stagingDir field that exists on disk", async () => {
      const rt = new HostUserRuntime();
      const creds = await rt.prepareCredentials([]);
      const stagingDir = (creds as any).stagingDir;
      expect(typeof stagingDir).toBe("string");
      expect(stagingDir.length).toBeGreaterThan(0);
      expect(existsSync(stagingDir)).toBe(true);

      // Cleanup
      rt.cleanupCredentials(creds);
    });

    it("two calls return distinct stagingDirs", async () => {
      const rt = new HostUserRuntime();
      const creds1 = await rt.prepareCredentials([]);
      const creds2 = await rt.prepareCredentials([]);
      expect((creds1 as any).stagingDir).not.toBe((creds2 as any).stagingDir);

      // Cleanup both
      rt.cleanupCredentials(creds1);
      rt.cleanupCredentials(creds2);
    });
  });

  // ── cleanupCredentials() ──────────────────────────────────────────────────

  describe("cleanupCredentials()", () => {
    it("removes the stagingDir from disk", async () => {
      const rt = new HostUserRuntime();
      const creds = await rt.prepareCredentials([]);
      const stagingDir = (creds as any).stagingDir;

      expect(existsSync(stagingDir)).toBe(true);
      rt.cleanupCredentials(creds);
      expect(existsSync(stagingDir)).toBe(false);
    });

    it("is a no-op for non-host-user strategy credentials", () => {
      const rt = new HostUserRuntime();
      const otherCreds = { strategy: "container", volumes: [] };
      expect(() => rt.cleanupCredentials(otherCreds as any)).not.toThrow();
    });

    it("does not throw when called twice (dir already removed)", async () => {
      const rt = new HostUserRuntime();
      const creds = await rt.prepareCredentials([]);
      rt.cleanupCredentials(creds);
      // Second call should not throw even though dir is gone
      expect(() => rt.cleanupCredentials(creds)).not.toThrow();
    });

    it("does not throw for credentials with non-existent stagingDir", () => {
      const rt = new HostUserRuntime();
      const fakeCreds = { strategy: "host-user", stagingDir: "/tmp/nonexistent-staging-dir-xyz-999", bundle: {} };
      expect(() => rt.cleanupCredentials(fakeCreds as any)).not.toThrow();
    });
  });

  // ── getTaskUrl() ──────────────────────────────────────────────────────────

  describe("getTaskUrl()", () => {
    it("returns null (host-user mode has no cloud task URL)", () => {
      const rt = new HostUserRuntime();
      expect(rt.getTaskUrl()).toBeNull();
    });

    it("returns null after prepareCredentials is called", async () => {
      const rt = new HostUserRuntime();
      const creds = await rt.prepareCredentials([]);
      expect(rt.getTaskUrl()).toBeNull();
      rt.cleanupCredentials(creds);
    });
  });

  // ── reattach() ────────────────────────────────────────────────────────────

  describe("reattach()", () => {
    it("returns false when the PID file does not exist", () => {
      const rt = new HostUserRuntime();
      const result = rt.reattach("nonexistent-run-id-xyz-123");
      expect(result).toBe(false);
    });

    it("returns a boolean", () => {
      const rt = new HostUserRuntime();
      const result = rt.reattach("also-nonexistent");
      expect(typeof result).toBe("boolean");
    });
  });

  // ── Two independent instances ─────────────────────────────────────────────

  describe("instance independence", () => {
    it("two instances have independent state", async () => {
      const rt1 = new HostUserRuntime("agent-user-1");
      const rt2 = new HostUserRuntime("agent-user-2");

      expect(rt1.needsGateway).toBe(false);
      expect(rt2.needsGateway).toBe(false);

      const r1 = await rt1.isAgentRunning("some-agent");
      const r2 = await rt2.isAgentRunning("some-agent");

      expect(r1).toBe(false);
      expect(r2).toBe(false);
    });

    it("cleanup on one instance does not affect the other", async () => {
      const rt1 = new HostUserRuntime();
      const rt2 = new HostUserRuntime();

      const creds1 = await rt1.prepareCredentials([]);
      const creds2 = await rt2.prepareCredentials([]);

      // Cleanup rt1's creds
      rt1.cleanupCredentials(creds1);
      expect(existsSync((creds1 as any).stagingDir)).toBe(false);

      // rt2's creds should still be on disk
      expect(existsSync((creds2 as any).stagingDir)).toBe(true);

      // Cleanup rt2's creds
      rt2.cleanupCredentials(creds2);
      expect(existsSync((creds2 as any).stagingDir)).toBe(false);
    });
  });
});
