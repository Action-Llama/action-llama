/**
 * Integration tests: cloud/vps/ssh.ts testConnection() and
 * cloud/vps/verify.ts verifyEnvironment() — no real SSH or Docker required.
 *
 * Both functions are designed to handle connection failures gracefully:
 *
 * testConnection(config):
 *   - Returns `false` when SSH to an unreachable host fails (catches all errors)
 *   - Returns `false` when the host port is not listening
 *
 * verifyEnvironment(opts):
 *   - Runs SSH connectivity check first (gate for all other checks)
 *   - Returns early with [{ name: "SSH connectivity", status: "fail", fixable: false }]
 *     when SSH fails (no real server needed)
 *   - The "check" and "fix" modes both behave identically when SSH fails
 *
 * clearKnownHost(host):
 *   - Runs `ssh-keygen -R <host>` to remove from known_hosts
 *   - On success or failure, does not throw (best-effort)
 *
 * Test scenarios (no real SSH or server required):
 *   1. testConnection() returns false for unreachable host
 *   2. testConnection() returns boolean (not undefined)
 *   3. verifyEnvironment() check mode returns array with SSH result when SSH fails
 *   4. verifyEnvironment() SSH fail result has status="fail"
 *   5. verifyEnvironment() SSH fail result has fixable=false
 *   6. verifyEnvironment() returns exactly 1 element when SSH fails (early return)
 *   7. verifyEnvironment() fix mode also fails early when SSH is unreachable
 *   8. CheckResult interface: name, status, fixable fields are present
 *   9. clearKnownHost() does not throw for an unreachable host
 *
 * Covers:
 *   - cloud/vps/ssh.ts: testConnection() → false on connection failure
 *   - cloud/vps/ssh.ts: clearKnownHost() → no-throw best-effort
 *   - cloud/vps/verify.ts: verifyEnvironment() — SSH fail → early return with fail result
 *   - cloud/vps/verify.ts: CheckResult interface shape
 *   - cloud/vps/verify.ts: sshConfigFrom() builds SshConfig from ServerConfig
 */

import { describe, it, expect } from "vitest";

const {
  testConnection,
  clearKnownHost,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/ssh.js"
);

const {
  verifyEnvironment,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/verify.js"
);

/** An unreachable SSH target (TEST-NET-1, guaranteed not to have SSH running). */
const UNREACHABLE_HOST = "192.0.2.1";
const UNREACHABLE_PORT = 22;

const UNREACHABLE_CONFIG = {
  host: UNREACHABLE_HOST,
  user: "test-user",
  port: UNREACHABLE_PORT,
  keyPath: "/dev/null",
};

// ── testConnection() ──────────────────────────────────────────────────────────

describe("cloud/vps/ssh.ts testConnection()", { timeout: 30_000 }, () => {

  it("returns false when SSH to unreachable host fails", async () => {
    const result = await testConnection(UNREACHABLE_CONFIG);
    expect(result).toBe(false);
  });

  it("returns boolean (not undefined or null)", async () => {
    const result = await testConnection(UNREACHABLE_CONFIG);
    expect(typeof result).toBe("boolean");
  });

  it("returns false for port that is not listening", async () => {
    // Port 65432 is almost certainly not in use
    const result = await testConnection({
      host: "127.0.0.1",
      user: "test",
      port: 65432,
      keyPath: "/dev/null",
    });
    expect(result).toBe(false);
  });
});

// ── clearKnownHost() ──────────────────────────────────────────────────────────

describe("cloud/vps/ssh.ts clearKnownHost()", { timeout: 15_000 }, () => {

  it("does not throw for a host not in known_hosts", () => {
    // ssh-keygen -R for an unknown host exits with 0 (no-op or warning)
    expect(() => clearKnownHost("192.0.2.254")).not.toThrow();
  });

  it("does not throw for an IP address that was never connected to", () => {
    // Even if the host was never in known_hosts, it should not throw
    expect(() => clearKnownHost("10.255.255.1")).not.toThrow();
  });
});

// ── verifyEnvironment() ───────────────────────────────────────────────────────

describe("cloud/vps/verify.ts verifyEnvironment()", { timeout: 30_000 }, () => {

  const UNREACHABLE_SERVER = {
    host: UNREACHABLE_HOST,
    user: "test-user",
    port: UNREACHABLE_PORT,
    // No keyPath — uses VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH
  };

  it("returns an array when SSH fails", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "check",
    });
    expect(Array.isArray(results)).toBe(true);
  });

  it("returns exactly one result when SSH fails (early return after SSH check)", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "check",
    });
    // SSH failure → early return with just the SSH result
    expect(results.length).toBe(1);
  });

  it("SSH result has name='SSH connectivity'", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "check",
    });
    expect(results[0].name).toBe("SSH connectivity");
  });

  it("SSH result has status='fail'", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "check",
    });
    expect(results[0].status).toBe("fail");
  });

  it("SSH result has fixable=false (SSH failures cannot be auto-fixed)", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "check",
    });
    expect(results[0].fixable).toBe(false);
  });

  it("SSH result has a detail string describing the failure", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "check",
    });
    expect(typeof results[0].detail).toBe("string");
    expect(results[0].detail!.length).toBeGreaterThan(0);
  });

  it("fix mode also returns SSH fail result early (same as check mode)", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "fix",
    });
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("fail");
  });

  it("CheckResult has all expected fields: name, status, fixable", async () => {
    const results = await verifyEnvironment({
      server: UNREACHABLE_SERVER,
      mode: "check",
    });
    const result = results[0];
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("fixable");
    expect(typeof result.name).toBe("string");
    expect(["pass", "fail", "warn", "fixed", "skip"]).toContain(result.status);
    expect(typeof result.fixable).toBe("boolean");
  });

  it("uses VPS_CONSTANTS defaults for missing user/port when ServerConfig omits them", async () => {
    // Server config with only host — VPS_CONSTANTS.DEFAULT_SSH_USER/PORT should be used
    const results = await verifyEnvironment({
      server: { host: UNREACHABLE_HOST }, // minimal config
      mode: "check",
    });
    // Should still fail (SSH unreachable) but not throw for missing user/port
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("fail");
  });
});
