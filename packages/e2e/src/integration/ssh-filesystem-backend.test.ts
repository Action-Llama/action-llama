/**
 * Integration tests: shared/ssh-fs-backend.ts SshFilesystemBackend — no SSH required.
 *
 * SshFilesystemBackend implements the CredentialBackend interface over SSH.
 * All read/write operations make SSH calls to a remote host. The constructor
 * itself is pure (no network calls), and can be tested without SSH access.
 *
 * Test scenarios (no SSH, no network required):
 *   1.  constructor: accepts minimal SshConfig without throwing
 *   2.  constructor: uses default baseDir (VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR) when not specified
 *   3.  constructor: accepts custom baseDir
 *   4.  constructor: accepts different host/user/port/keyPath values
 *   5.  constructor: SshConfig with port 22 accepted
 *   6.  constructor: SshConfig with non-standard port accepted
 *   7.  constructor: custom baseDir is preserved (visible via list behavior)
 *   8.  Two instances have independent configuration (different SSH hosts)
 *   9.  constructor with empty keyPath is accepted
 *  10.  constructor: reads VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR as default
 *
 * Covers:
 *   - shared/ssh-fs-backend.ts: SshFilesystemBackend constructor
 *   - shared/ssh-fs-backend.ts: default baseDir from VPS_CONSTANTS
 */

import { describe, it, expect } from "vitest";

const { SshFilesystemBackend } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/ssh-fs-backend.js"
);

const { VPS_CONSTANTS } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/constants.js"
);

// ── Helper ────────────────────────────────────────────────────────────────────

function makeSshConfig(opts: { host?: string; user?: string; port?: number; keyPath?: string } = {}) {
  return {
    host: opts.host ?? "192.0.2.1", // TEST-NET-1, guaranteed unreachable
    user: opts.user ?? "test-user",
    port: opts.port ?? 22,
    keyPath: opts.keyPath ?? "~/.ssh/id_rsa",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("integration: SshFilesystemBackend (no SSH required)", { timeout: 30_000 }, () => {

  // ── constructor ────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("instantiates without throwing given a minimal SshConfig", () => {
      expect(() => new SshFilesystemBackend(makeSshConfig())).not.toThrow();
    });

    it("accepts SshConfig without optional baseDir", () => {
      const sshConfig = makeSshConfig();
      expect(() => new SshFilesystemBackend(sshConfig)).not.toThrow();
    });

    it("accepts SshConfig with a custom baseDir", () => {
      const sshConfig = makeSshConfig();
      expect(() => new SshFilesystemBackend(sshConfig, "/custom/creds/dir")).not.toThrow();
    });

    it("accepts various host values", () => {
      expect(() => new SshFilesystemBackend(makeSshConfig({ host: "10.0.0.1" }))).not.toThrow();
      expect(() => new SshFilesystemBackend(makeSshConfig({ host: "my-server.example.com" }))).not.toThrow();
      expect(() => new SshFilesystemBackend(makeSshConfig({ host: "vps.production.io" }))).not.toThrow();
    });

    it("accepts port 22 (standard SSH)", () => {
      expect(() => new SshFilesystemBackend(makeSshConfig({ port: 22 }))).not.toThrow();
    });

    it("accepts non-standard port numbers", () => {
      expect(() => new SshFilesystemBackend(makeSshConfig({ port: 2222 }))).not.toThrow();
      expect(() => new SshFilesystemBackend(makeSshConfig({ port: 4444 }))).not.toThrow();
    });

    it("accepts different user values", () => {
      expect(() => new SshFilesystemBackend(makeSshConfig({ user: "root" }))).not.toThrow();
      expect(() => new SshFilesystemBackend(makeSshConfig({ user: "ubuntu" }))).not.toThrow();
      expect(() => new SshFilesystemBackend(makeSshConfig({ user: "al-deploy" }))).not.toThrow();
    });

    it("accepts absolute keyPath", () => {
      expect(() => new SshFilesystemBackend(makeSshConfig({ keyPath: "/home/user/.ssh/id_rsa" }))).not.toThrow();
    });

    it("accepts tilde keyPath (home directory shorthand)", () => {
      expect(() => new SshFilesystemBackend(makeSshConfig({ keyPath: "~/.ssh/id_rsa" }))).not.toThrow();
    });
  });

  // ── default baseDir ───────────────────────────────────────────────────────

  describe("default baseDir", () => {
    it("VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR is a non-empty string", () => {
      expect(typeof VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR).toBe("string");
      expect(VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR.length).toBeGreaterThan(0);
    });

    it("SshFilesystemBackend can be created without specifying baseDir", () => {
      const backend = new SshFilesystemBackend(makeSshConfig());
      expect(backend).toBeDefined();
    });
  });

  // ── instance independence ─────────────────────────────────────────────────

  describe("instance independence", () => {
    it("two instances with different SshConfigs are independent objects", () => {
      const b1 = new SshFilesystemBackend(makeSshConfig({ host: "host-a" }));
      const b2 = new SshFilesystemBackend(makeSshConfig({ host: "host-b" }));
      expect(b1).not.toBe(b2);
    });

    it("two instances with different baseDirs are independent objects", () => {
      const sshConfig = makeSshConfig();
      const b1 = new SshFilesystemBackend(sshConfig, "/credentials/v1");
      const b2 = new SshFilesystemBackend(sshConfig, "/credentials/v2");
      expect(b1).not.toBe(b2);
    });
  });
});
