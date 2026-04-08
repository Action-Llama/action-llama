/**
 * Integration tests: cloud/cloudflare/api.ts API function error behavior
 * with invalid tokens — no Docker required.
 *
 * The cloudflare API functions call `cfFetch()` which makes real HTTP requests
 * to api.cloudflare.com. With an invalid API token, Cloudflare returns a
 * 400 Bad Request response, causing cfFetch() to throw a CloudflareApiError.
 *
 * This documents the error-throwing behavior for the main exported functions:
 *   - listAllZones(invalidToken) → throws CloudflareApiError
 *   - listZones(invalidToken, name) → throws CloudflareApiError
 *   - findDnsRecord(invalidToken, zoneId, hostname) → throws CloudflareApiError
 *   - createDnsRecord(invalidToken, ...) → throws CloudflareApiError
 *   - updateDnsRecord(invalidToken, ...) → throws CloudflareApiError
 *   - deleteDnsRecord(invalidToken, ...) → throws CloudflareApiError
 *   - getSslMode(invalidToken, zoneId) → throws CloudflareApiError
 *
 * Note: verifyToken() is NOT tested here since it already has a test in
 * cloud-api-utils.test.ts and it catches errors and returns false (not throws).
 *
 * Covers:
 *   - cloud/cloudflare/api.ts: listAllZones() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: listZones() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: findDnsRecord() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: createDnsRecord() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: updateDnsRecord() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: deleteDnsRecord() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: getSslMode() → throws CloudflareApiError with invalid token
 *   - cloud/cloudflare/api.ts: CloudflareApiError.statusCode reflects HTTP status code
 */

import { describe, it, expect } from "vitest";

const {
  CloudflareApiError,
  listAllZones,
  listZones,
  findDnsRecord,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  getSslMode,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/cloudflare/api.js"
);

const INVALID_TOKEN = "definitely-not-a-real-cloudflare-api-token-abc123";
const FAKE_ZONE_ID = "fake-zone-id-for-testing-000000000000000";
const FAKE_RECORD_ID = "fake-record-id-for-testing-000000000000";
const FAKE_HOSTNAME = "test.example.com";

describe("integration: cloud/cloudflare/api.ts error paths with invalid token", { timeout: 60_000 }, () => {

  // ── listAllZones ──────────────────────────────────────────────────────────

  it("listAllZones() throws CloudflareApiError with invalid token", async () => {
    await expect(listAllZones(INVALID_TOKEN)).rejects.toThrow(CloudflareApiError);
  });

  it("listAllZones() error has a statusCode (HTTP status from Cloudflare)", async () => {
    let caught: unknown;
    try { await listAllZones(INVALID_TOKEN); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CloudflareApiError);
    expect(typeof (caught as any).statusCode).toBe("number");
  });

  it("listAllZones() is an instanceof Error", async () => {
    let caught: unknown;
    try { await listAllZones(INVALID_TOKEN); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
  });

  // ── listZones ─────────────────────────────────────────────────────────────

  it("listZones() throws CloudflareApiError with invalid token", async () => {
    await expect(listZones(INVALID_TOKEN, "example.com")).rejects.toThrow(CloudflareApiError);
  });

  it("listZones() error message mentions Cloudflare API", async () => {
    let caught: unknown;
    try { await listZones(INVALID_TOKEN, "test.com"); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CloudflareApiError);
    expect((caught as Error).message).toMatch(/Cloudflare API/);
  });

  // ── findDnsRecord ─────────────────────────────────────────────────────────

  it("findDnsRecord() throws CloudflareApiError with invalid token", async () => {
    await expect(
      findDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_HOSTNAME)
    ).rejects.toThrow(CloudflareApiError);
  });

  // ── createDnsRecord ───────────────────────────────────────────────────────

  it("createDnsRecord() throws CloudflareApiError with invalid token", async () => {
    await expect(
      createDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_HOSTNAME, "1.2.3.4")
    ).rejects.toThrow(CloudflareApiError);
  });

  // ── updateDnsRecord ───────────────────────────────────────────────────────

  it("updateDnsRecord() throws CloudflareApiError with invalid token", async () => {
    await expect(
      updateDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_RECORD_ID, "1.2.3.4")
    ).rejects.toThrow(CloudflareApiError);
  });

  // ── deleteDnsRecord ───────────────────────────────────────────────────────

  it("deleteDnsRecord() throws CloudflareApiError with invalid token", async () => {
    await expect(
      deleteDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_RECORD_ID)
    ).rejects.toThrow(CloudflareApiError);
  });

  it("deleteDnsRecord() thrown error is an Error instance", async () => {
    let caught: unknown;
    try { await deleteDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_RECORD_ID); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
  });

  // ── getSslMode ────────────────────────────────────────────────────────────

  it("getSslMode() throws CloudflareApiError with invalid token", async () => {
    await expect(
      getSslMode(INVALID_TOKEN, FAKE_ZONE_ID)
    ).rejects.toThrow(CloudflareApiError);
  });

  // ── CloudflareApiError statusCode ─────────────────────────────────────────

  it("all thrown errors have a numeric statusCode property", async () => {
    const fns = [
      () => listAllZones(INVALID_TOKEN),
      () => listZones(INVALID_TOKEN, "test.com"),
      () => findDnsRecord(INVALID_TOKEN, FAKE_ZONE_ID, FAKE_HOSTNAME),
    ];

    for (const fn of fns) {
      let caught: unknown;
      try { await fn(); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CloudflareApiError);
      expect(typeof (caught as any).statusCode).toBe("number");
      // Cloudflare returns 400 for invalid token format
      expect((caught as any).statusCode).toBeGreaterThanOrEqual(400);
    }
  });
});
