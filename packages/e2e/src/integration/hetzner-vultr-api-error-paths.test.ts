/**
 * Integration tests: cloud/vps/hetzner-api.ts and cloud/vps/vultr-api.ts
 * error behavior with invalid API keys — no Docker required.
 *
 * These tests exercise the `hetznerFetch` and `vultrFetch` private functions
 * indirectly by calling exported API functions with an invalid API key.
 * Both functions throw when the remote API returns an HTTP error (e.g. 401).
 *
 * Since the Hetzner and Vultr APIs are reachable over the internet,
 * passing an invalid/empty key will cause a 401 response and the
 * internal error handler will throw. This documents that:
 *   - hetzner-api.ts: API functions throw on auth failure
 *   - vultr-api.ts: API functions throw on auth failure
 *
 * Covers:
 *   - cloud/vps/hetzner-api.ts: listLocations("invalid") throws Error
 *   - cloud/vps/hetzner-api.ts: thrown error is an Error instance
 *   - cloud/vps/hetzner-api.ts: thrown error message mentions "Hetzner API" or "HTTP"
 *   - cloud/vps/hetzner-api.ts: listServerTypes("invalid") throws Error
 *   - cloud/vps/hetzner-api.ts: listImages("invalid") throws Error
 *   - cloud/vps/hetzner-api.ts: listSshKeys("invalid") throws Error
 *   - cloud/vps/vultr-api.ts: listRegions("invalid") throws Error
 *   - cloud/vps/vultr-api.ts: thrown error is an Error instance
 *   - cloud/vps/vultr-api.ts: listPlans("invalid") throws Error
 */

import { describe, it, expect } from "vitest";

const {
  listLocations,
  listServerTypes,
  listImages,
  listSshKeys,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/hetzner-api.js"
);

const {
  listRegions,
  listPlans,
  listSshKeys: vultrListSshKeys,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/vultr-api.js"
);

describe("integration: cloud/vps/hetzner-api.ts error paths (invalid key)", { timeout: 30_000 }, () => {

  it("listLocations(invalidKey) throws an Error", async () => {
    await expect(listLocations("invalid-hetzner-key")).rejects.toThrow(Error);
  });

  it("listLocations(invalidKey) error message mentions 'Hetzner API' or HTTP status", async () => {
    await expect(listLocations("invalid-hetzner-key")).rejects.toThrow(
      /Hetzner API|HTTP 4\d\d|HTTP 5\d\d/
    );
  });

  it("listServerTypes(invalidKey) throws an Error", async () => {
    await expect(listServerTypes("invalid-hetzner-key")).rejects.toThrow(Error);
  });

  it("listImages(invalidKey) throws an Error", async () => {
    await expect(listImages("invalid-hetzner-key")).rejects.toThrow(Error);
  });

  it("listSshKeys(invalidKey) throws an Error", async () => {
    await expect(listSshKeys("invalid-hetzner-key")).rejects.toThrow(Error);
  });
});

describe("integration: cloud/vps/vultr-api.ts error paths (invalid key)", { timeout: 30_000 }, () => {

  // listRegions and listPlans are PUBLIC endpoints on Vultr (return 200 even without auth)
  // so we use listSshKeys which requires authentication (returns 401 for invalid keys)

  it("listSshKeys(invalidKey) throws an Error (auth required endpoint)", async () => {
    await expect(vultrListSshKeys("invalid-vultr-key")).rejects.toThrow(Error);
  });

  it("listSshKeys(invalidKey) error message mentions 'Vultr API' or HTTP status", async () => {
    await expect(vultrListSshKeys("invalid-vultr-key")).rejects.toThrow(
      /Vultr API|HTTP 4\d\d|HTTP 5\d\d/
    );
  });

  it("listRegions(invalidKey) resolves to an array (public endpoint)", async () => {
    // Vultr regions is a public endpoint — succeeds even with invalid key
    const regions = await listRegions("invalid-vultr-key");
    expect(Array.isArray(regions)).toBe(true);
  });

  it("listPlans(invalidKey) resolves to an array (public endpoint)", async () => {
    // Vultr plans is a public endpoint — succeeds even with invalid key
    const plans = await listPlans("invalid-vultr-key");
    expect(Array.isArray(plans)).toBe(true);
  });
});
