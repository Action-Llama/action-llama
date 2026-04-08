/**
 * Integration tests: cloud/cloudflare/api.ts remaining API functions
 * upsertDnsRecord(), setSslMode(), createOriginCertificate() — no Docker required.
 *
 * The existing cloudflare-api-error-paths.test.ts covers the main CRUD functions.
 * This test covers the remaining exported functions:
 *   - upsertDnsRecord(): delegates to findDnsRecord → createDnsRecord or updateDnsRecord
 *     With invalid token, findDnsRecord throws, propagating the error
 *   - setSslMode(): PATCH request; invalid token → CloudflareApiError
 *   - createOriginCertificate(): generates CSR via openssl + POST request;
 *     invalid token → CloudflareApiError
 *
 * Note: createOriginCertificate() requires `openssl` in PATH. If not available,
 * the test is skipped.
 *
 * Covers:
 *   - cloud/cloudflare/api.ts: upsertDnsRecord() → throws CloudflareApiError (via findDnsRecord)
 *   - cloud/cloudflare/api.ts: setSslMode() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: createOriginCertificate() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: upsertDnsRecord() is instance of CloudflareApiError
 *   - cloud/cloudflare/api.ts: setSslMode() is instance of CloudflareApiError
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

const {
  CloudflareApiError,
  upsertDnsRecord,
  setSslMode,
  createOriginCertificate,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/cloudflare/api.js"
);

const INVALID_TOKEN = "definitely-not-a-real-cloudflare-api-token-abc123";
const FAKE_ZONE_ID = "fake-zone-id-for-testing-000000000000000";
const FAKE_HOSTNAME = "test.example.com";

function opensslAvailable(): boolean {
  try {
    execSync("openssl version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── upsertDnsRecord ──────────────────────────────────────────────────────────

describe("integration: cloud/cloudflare/api.ts upsertDnsRecord() error path", { timeout: 60_000 }, () => {
  it("upsertDnsRecord() throws CloudflareApiError with invalid token", async () => {
    await expect(
      upsertDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_HOSTNAME, "1.2.3.4")
    ).rejects.toThrow(CloudflareApiError);
  });

  it("upsertDnsRecord() error is instanceof CloudflareApiError", async () => {
    let caught: any;
    try {
      await upsertDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_HOSTNAME, "1.2.3.4");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudflareApiError);
  });

  it("upsertDnsRecord() error has statusCode from HTTP response", async () => {
    let caught: any;
    try {
      await upsertDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_HOSTNAME, "5.6.7.8");
    } catch (e) {
      caught = e;
    }
    expect(typeof caught.statusCode).toBe("number");
    expect(caught.statusCode).toBeGreaterThan(0);
  });
});

// ── setSslMode ────────────────────────────────────────────────────────────────

describe("integration: cloud/cloudflare/api.ts setSslMode() error path", { timeout: 60_000 }, () => {
  it("setSslMode() throws CloudflareApiError with invalid token", async () => {
    await expect(
      setSslMode(INVALID_TOKEN, FAKE_ZONE_ID, "full")
    ).rejects.toThrow(CloudflareApiError);
  });

  it("setSslMode() error is instanceof CloudflareApiError", async () => {
    let caught: any;
    try {
      await setSslMode(INVALID_TOKEN, FAKE_ZONE_ID, "strict");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudflareApiError);
  });

  it("setSslMode() accepts all valid SSL mode values without throwing type errors", async () => {
    // Just verify the function accepts these values (network will fail but type check passes)
    const modes = ["off", "flexible", "full", "strict"] as const;
    for (const mode of modes) {
      await expect(
        setSslMode(INVALID_TOKEN, FAKE_ZONE_ID, mode)
      ).rejects.toThrow(CloudflareApiError);
    }
  });
});

// ── createOriginCertificate ───────────────────────────────────────────────────

describe("integration: cloud/cloudflare/api.ts createOriginCertificate() error path", { timeout: 60_000 }, () => {
  it.skipIf(!opensslAvailable())(
    "createOriginCertificate() throws CloudflareApiError when token invalid (openssl must be available)",
    async () => {
      await expect(
        createOriginCertificate(INVALID_TOKEN, [FAKE_HOSTNAME])
      ).rejects.toThrow(CloudflareApiError);
    }
  );

  it.skipIf(!opensslAvailable())(
    "createOriginCertificate() error is instanceof CloudflareApiError",
    async () => {
      let caught: any;
      try {
        await createOriginCertificate(INVALID_TOKEN, ["example.com"], 365);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CloudflareApiError);
    }
  );
});
