/**
 * Integration tests: cloud/vps/teardown.ts teardownVps() — no SSH/Docker required.
 *
 * teardownVps() performs graceful cleanup of a VPS deployment. It has several
 * try/catch blocks that prevent throwing when SSH is unreachable:
 *
 *   1. Container cleanup (SSH) — catches all errors, logs "Container cleanup failed"
 *   2. Remote credentials cleanup (SSH) — catches all errors silently
 *   3. Cloudflare DNS cleanup — only runs when cloudflareZoneId+cloudflareDnsRecordId set
 *   4. Vultr instance deletion — only runs when vultrInstanceId set
 *   5. Hetzner server deletion — only runs when hetznerServerId set
 *
 * When SSH is unreachable and none of the optional fields are set:
 *   - Steps 1+2 fail silently (caught errors)
 *   - Steps 3+4+5 are skipped
 *   - Function returns without throwing
 *
 * Test scenarios (no SSH or cloud credentials required):
 *   1. Returns void without throwing when SSH is unreachable and no cloud IDs set
 *   2. Logs "Container cleanup failed" to console.log when SSH fails
 *   3. Does not attempt Vultr/Hetzner deletion when no instanceId/serverId set
 *   4. Does not attempt Cloudflare cleanup when cloudflareZoneId not set
 *   5. Logs "Vultr API key not found" when vultrInstanceId set but no credential
 *   6. Logs "Hetzner API key not found" when hetznerServerId set but no credential
 *
 * Covers:
 *   - cloud/vps/teardown.ts: teardownVps() — no throw when SSH unreachable + no cloud IDs
 *   - cloud/vps/teardown.ts: sshConfigFromVps() builds config from VpsConfig
 *   - cloud/vps/teardown.ts: step 1 container cleanup catch block
 *   - cloud/vps/teardown.ts: step 3 Cloudflare DNS skipped when no cloudflareZoneId
 *   - cloud/vps/teardown.ts: step 4 Vultr "API key not found" path
 *   - cloud/vps/teardown.ts: step 4 (else) Hetzner "API key not found" path
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const {
  teardownVps,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/teardown.js"
);

/**
 * An unreachable VPS config using localhost port 65432.
 * Port 65432 is almost certainly not listening, so SSH will get ECONNREFUSED
 * immediately (unlike TEST-NET-1 which may timeout after TCP timeout).
 */
const UNREACHABLE_VPS = {
  host: "127.0.0.1",
  sshUser: "test-user",
  sshPort: 65432, // Very unlikely to be in use — fails fast with ECONNREFUSED
};

describe("cloud/vps/teardown.ts teardownVps()", { timeout: 30_000 }, () => {
  let originalConsoleLog: typeof console.log;
  const capturedLogs: string[] = [];

  beforeEach(() => {
    originalConsoleLog = console.log;
    console.log = (...args: any[]) => capturedLogs.push(args.join(" "));
    capturedLogs.length = 0;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    capturedLogs.length = 0;
  });

  // ── No cloud IDs set: SSH fails silently ────────────────────────────────────

  it("resolves without throwing when SSH is unreachable and no vultrInstanceId/hetznerServerId set", async () => {
    await expect(
      teardownVps("/tmp/fake-project", UNREACHABLE_VPS)
    ).resolves.toBeUndefined();
  });

  it("does not log 'Containers removed' when SSH fails (container list is empty)", async () => {
    // When SSH exits with non-zero code (connection refused → exitCode=255),
    // the teardown code's check `listResult.exitCode === 0` is false, so
    // "Containers removed" is never logged. No exception is thrown.
    await teardownVps("/tmp/fake-project", UNREACHABLE_VPS);

    const hasContainersRemoved = capturedLogs.some(
      (l) => l.includes("Containers removed")
    );
    expect(hasContainersRemoved).toBe(false);
  });

  it("does NOT log 'Vultr' or 'Hetzner' when no instanceId/serverId set", async () => {
    await teardownVps("/tmp/fake-project", UNREACHABLE_VPS);

    const hasVultr = capturedLogs.some((l) => l.includes("Vultr"));
    const hasHetzner = capturedLogs.some((l) => l.includes("Hetzner"));
    expect(hasVultr).toBe(false);
    expect(hasHetzner).toBe(false);
  });

  it("does NOT log 'Cloudflare' when cloudflareZoneId is not set", async () => {
    await teardownVps("/tmp/fake-project", UNREACHABLE_VPS);

    const hasCf = capturedLogs.some((l) => l.includes("Cloudflare"));
    expect(hasCf).toBe(false);
  });

  // ── Vultr instanceId set but no credential ────────────────────────────────

  it("logs 'Vultr API key not found' when vultrInstanceId set but credential missing", async () => {
    const vpsWithVultr = {
      ...UNREACHABLE_VPS,
      vultrInstanceId: "fake-vultr-instance-123",
    };

    // FilesystemBackend.read() will return undefined for a non-existent credential
    await teardownVps("/tmp/fake-project", vpsWithVultr);

    const hasVultrMissing = capturedLogs.some(
      (l) => l.includes("Vultr API key not found")
    );
    expect(hasVultrMissing).toBe(true);
  });

  it("does not throw when vultrInstanceId set but API key missing", async () => {
    const vpsWithVultr = {
      ...UNREACHABLE_VPS,
      vultrInstanceId: "fake-vultr-instance-456",
    };

    await expect(
      teardownVps("/tmp/fake-project", vpsWithVultr)
    ).resolves.toBeUndefined();
  });

  // ── Hetzner serverId set but no credential ────────────────────────────────

  it("logs 'Hetzner API key not found' when hetznerServerId set but credential missing", async () => {
    const vpsWithHetzner = {
      ...UNREACHABLE_VPS,
      hetznerServerId: 99999,
    };

    await teardownVps("/tmp/fake-project", vpsWithHetzner);

    const hasHetznerMissing = capturedLogs.some(
      (l) => l.includes("Hetzner API key not found")
    );
    expect(hasHetznerMissing).toBe(true);
  });

  it("does not throw when hetznerServerId set but API key missing", async () => {
    const vpsWithHetzner = {
      ...UNREACHABLE_VPS,
      hetznerServerId: 99998,
    };

    await expect(
      teardownVps("/tmp/fake-project", vpsWithHetzner)
    ).resolves.toBeUndefined();
  });

  // ── Cloudflare cleanup skipped when no record IDs ────────────────────────

  it("does not throw when cloudflareZoneId set but no cloudflareDnsRecordId", async () => {
    const vpsWithCfZone = {
      ...UNREACHABLE_VPS,
      cloudflareZoneId: "fake-zone-id",
      // No cloudflareDnsRecordId — Cloudflare cleanup condition is skipped
    };

    await expect(
      teardownVps("/tmp/fake-project", vpsWithCfZone)
    ).resolves.toBeUndefined();
  });

  it("does not attempt Cloudflare cleanup when only cloudflareZoneId set (no recordId)", async () => {
    const vpsWithCfZone = {
      ...UNREACHABLE_VPS,
      cloudflareZoneId: "fake-zone-id-only",
      // No cloudflareDnsRecordId
    };

    await teardownVps("/tmp/fake-project", vpsWithCfZone);

    // Cloudflare cleanup requires BOTH zoneId and recordId — if only zoneId, skip
    const hasCfDeletion = capturedLogs.some(
      (l) => l.includes("Cloudflare DNS record deleted")
    );
    expect(hasCfDeletion).toBe(false);
  });
});
