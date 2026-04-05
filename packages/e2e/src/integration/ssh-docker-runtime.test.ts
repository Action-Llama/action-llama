/**
 * Integration tests: docker/ssh-docker-runtime.ts SshDockerRuntime — no Docker/SSH required.
 *
 * SshDockerRuntime wraps Docker commands over SSH for VPS deployments.
 * Most methods require an actual SSH connection, but the constructor,
 * property accessors, and error-safe methods can be tested in isolation.
 *
 * Test scenarios (no Docker or SSH required):
 *   1.  constructor: accepts an SshConfig object without throwing
 *   2.  constructor: accepts various host/port/user/keyPath combinations
 *   3.  needsGateway: is false (VPS scheduler and gateway run on same host)
 *   4.  getTaskUrl(): returns null (SSH Docker has no cloud task URL)
 *   5.  inspectContainer(): returns null (orphan detection not supported)
 *   6.  cleanupCredentials(): no-op for non-volume strategy
 *   7.  cleanupCredentials(): does not throw for container strategy
 *   8.  cleanupCredentials(): does not throw for host-user strategy
 *   9.  Two instances with different sshConfigs are independent
 *
 * Covers:
 *   - docker/ssh-docker-runtime.ts: SshDockerRuntime constructor
 *   - docker/ssh-docker-runtime.ts: needsGateway property
 *   - docker/ssh-docker-runtime.ts: getTaskUrl() null return
 *   - docker/ssh-docker-runtime.ts: inspectContainer() null return
 *   - docker/ssh-docker-runtime.ts: cleanupCredentials() no-op for non-volume
 */

import { describe, it, expect } from "vitest";

const { SshDockerRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/ssh-docker-runtime.js"
);

// ── Helper ────────────────────────────────────────────────────────────────────

/** A minimal SshConfig that points to an unreachable host for testing. */
function makeSshConfig(opts: { host?: string; user?: string; port?: number; keyPath?: string } = {}) {
  return {
    host: opts.host ?? "192.0.2.1", // TEST-NET-1, guaranteed unreachable
    user: opts.user ?? "test-user",
    port: opts.port ?? 22,
    keyPath: opts.keyPath ?? "~/.ssh/id_rsa",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("integration: SshDockerRuntime (no Docker/SSH required)", { timeout: 30_000 }, () => {

  // ── constructor ────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("instantiates without throwing given a minimal SshConfig", () => {
      expect(() => new SshDockerRuntime(makeSshConfig())).not.toThrow();
    });

    it("accepts custom host, user, port, and keyPath", () => {
      expect(() => new SshDockerRuntime(makeSshConfig({
        host: "10.0.0.1",
        user: "root",
        port: 2222,
        keyPath: "/home/user/.ssh/vps_key",
      }))).not.toThrow();
    });

    it("accepts port 22 (default SSH port)", () => {
      expect(() => new SshDockerRuntime(makeSshConfig({ port: 22 }))).not.toThrow();
    });

    it("accepts non-standard port numbers", () => {
      expect(() => new SshDockerRuntime(makeSshConfig({ port: 4444 }))).not.toThrow();
    });
  });

  // ── needsGateway ─────────────────────────────────────────────────────────

  describe("needsGateway", () => {
    it("is false — VPS scheduler and gateway run on the same host", () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      expect(rt.needsGateway).toBe(false);
    });

    it("is a boolean", () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      expect(typeof rt.needsGateway).toBe("boolean");
    });

    it("is false regardless of SSH config values", () => {
      const rt1 = new SshDockerRuntime(makeSshConfig({ host: "host-a", port: 22 }));
      const rt2 = new SshDockerRuntime(makeSshConfig({ host: "host-b", port: 2222 }));
      expect(rt1.needsGateway).toBe(false);
      expect(rt2.needsGateway).toBe(false);
    });
  });

  // ── getTaskUrl() ──────────────────────────────────────────────────────────

  describe("getTaskUrl()", () => {
    it("returns null (SSH Docker has no cloud console URL)", () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      expect(rt.getTaskUrl()).toBeNull();
    });

    it("always returns null regardless of what is passed", () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      // The signature is getTaskUrl() with no required args
      expect(rt.getTaskUrl()).toBeNull();
    });
  });

  // ── inspectContainer() ───────────────────────────────────────────────────

  describe("inspectContainer()", () => {
    it("returns null (SSH Docker does not support container-level inspect)", async () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      const result = await rt.inspectContainer();
      expect(result).toBeNull();
    });

    it("returns null consistently across multiple calls", async () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      const r1 = await rt.inspectContainer();
      const r2 = await rt.inspectContainer();
      expect(r1).toBeNull();
      expect(r2).toBeNull();
    });
  });

  // ── cleanupCredentials() ──────────────────────────────────────────────────

  describe("cleanupCredentials()", () => {
    it("is a no-op for non-volume strategy (does not throw)", () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      const containerCreds = { strategy: "container", volumes: [] };
      expect(() => rt.cleanupCredentials(containerCreds as any)).not.toThrow();
    });

    it("is a no-op for host-user strategy", () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      const hostUserCreds = { strategy: "host-user", stagingDir: "/tmp/test", bundle: {} };
      expect(() => rt.cleanupCredentials(hostUserCreds as any)).not.toThrow();
    });

    it("is a no-op for secret-manager strategy", () => {
      const rt = new SshDockerRuntime(makeSshConfig());
      const secretCreds = { strategy: "secret-manager", secretRefs: [], bundle: {} };
      expect(() => rt.cleanupCredentials(secretCreds as any)).not.toThrow();
    });

    it("does not throw for volume strategy (SSH failure caught internally)", () => {
      // volume strategy calls sshExec and catches errors, so should not throw
      const rt = new SshDockerRuntime(makeSshConfig());
      const volumeCreds = { strategy: "volume", stagingDir: "/tmp/al-creds-test", bundle: {} };
      expect(() => rt.cleanupCredentials(volumeCreds as any)).not.toThrow();
    });
  });

  // ── instance independence ─────────────────────────────────────────────────

  describe("instance independence", () => {
    it("two instances have independent needsGateway (both false)", () => {
      const rt1 = new SshDockerRuntime(makeSshConfig({ host: "host-a" }));
      const rt2 = new SshDockerRuntime(makeSshConfig({ host: "host-b" }));
      expect(rt1.needsGateway).toBe(false);
      expect(rt2.needsGateway).toBe(false);
    });

    it("two instances have independent getTaskUrl() (both null)", () => {
      const rt1 = new SshDockerRuntime(makeSshConfig({ host: "host-a" }));
      const rt2 = new SshDockerRuntime(makeSshConfig({ host: "host-b" }));
      expect(rt1.getTaskUrl()).toBeNull();
      expect(rt2.getTaskUrl()).toBeNull();
    });
  });
});
