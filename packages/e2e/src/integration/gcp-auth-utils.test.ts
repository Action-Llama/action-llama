/**
 * Integration tests: GCP auth utility functions — no Docker required.
 *
 * The GCP Cloud Run Jobs integration (feat commit df637a5d) introduced
 * pure utility functions in cloud/gcp/auth.ts:
 *   - parseServiceAccountKey(json) — validates and parses a GCP service account JSON key
 *   - GcpAuth class — caches and refreshes OAuth 2.0 access tokens
 *
 * And cloud/gcp/cloud-run-api.ts:
 *   - GcpApiError — custom error class with statusCode field
 *
 * These are exercised here directly against the built dist, similar to other
 * integration tests that import pure functions without starting the scheduler.
 *
 * Test scenarios (no Docker or GCP credentials required):
 *   1. parseServiceAccountKey: parses a valid service account key JSON
 *   2. parseServiceAccountKey: throws "Invalid JSON" for non-JSON input
 *   3. parseServiceAccountKey: throws when type !== "service_account"
 *   4. parseServiceAccountKey: throws when private_key is missing
 *   5. parseServiceAccountKey: throws when client_email is missing
 *   6. parseServiceAccountKey: throws when project_id is missing
 *   7. GcpApiError: has correct name, message, and statusCode
 *   8. GcpApiError: is instanceof Error and instanceof GcpApiError
 *   9. GcpAuth: constructor does not throw for a valid key
 *   10. GcpAuth: getAccessToken() throws on network error (no real GCP)
 *
 * Covers:
 *   - cloud/gcp/auth.ts: parseServiceAccountKey() all validation paths
 *   - cloud/gcp/auth.ts: GcpAuth constructor
 *   - cloud/gcp/cloud-run-api.ts: GcpApiError class
 */

import { describe, it, expect } from "vitest";

const { parseServiceAccountKey, GcpAuth } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/auth.js"
);

const { GcpApiError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/cloud-run-api.js"
);

// A fake RSA key structure (not a real key — only used to test parsing, not signing)
const VALID_KEY_JSON = JSON.stringify({
  type: "service_account",
  project_id: "my-test-project",
  private_key_id: "key-abc123",
  private_key:
    "-----BEGIN RSA PRIVATE KEY-----\nFAKE_KEY_DATA\n-----END RSA PRIVATE KEY-----\n",
  client_email: "test-sa@my-test-project.iam.gserviceaccount.com",
  client_id: "123456789",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
});

describe("integration: parseServiceAccountKey (no Docker required)", () => {
  it("parses a valid service account key JSON", () => {
    const key = parseServiceAccountKey(VALID_KEY_JSON);
    expect(key.type).toBe("service_account");
    expect(key.project_id).toBe("my-test-project");
    expect(key.client_email).toBe(
      "test-sa@my-test-project.iam.gserviceaccount.com",
    );
    expect(key.private_key).toContain("RSA PRIVATE KEY");
  });

  it("throws 'Invalid JSON' for non-JSON input", () => {
    expect(() => parseServiceAccountKey("not-json")).toThrow("Invalid JSON");
  });

  it("throws when type is not 'service_account'", () => {
    const key = JSON.parse(VALID_KEY_JSON);
    key.type = "authorized_user";
    expect(() => parseServiceAccountKey(JSON.stringify(key))).toThrow(
      'JSON key type must be "service_account"',
    );
  });

  it("throws when private_key is missing", () => {
    const key = JSON.parse(VALID_KEY_JSON);
    delete key.private_key;
    expect(() => parseServiceAccountKey(JSON.stringify(key))).toThrow(
      "JSON key missing required fields",
    );
  });

  it("throws when client_email is missing", () => {
    const key = JSON.parse(VALID_KEY_JSON);
    delete key.client_email;
    expect(() => parseServiceAccountKey(JSON.stringify(key))).toThrow(
      "JSON key missing required fields",
    );
  });

  it("throws when project_id is missing", () => {
    const key = JSON.parse(VALID_KEY_JSON);
    delete key.project_id;
    expect(() => parseServiceAccountKey(JSON.stringify(key))).toThrow(
      "JSON key missing required fields",
    );
  });

  it("preserves all key fields in parsed output", () => {
    const key = parseServiceAccountKey(VALID_KEY_JSON);
    expect(key.private_key_id).toBe("key-abc123");
    expect(key.client_id).toBe("123456789");
    expect(key.auth_uri).toBe("https://accounts.google.com/o/oauth2/auth");
    expect(key.token_uri).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("integration: GcpAuth constructor (no Docker required)", () => {
  it("constructs without throwing for a valid key", () => {
    const key = parseServiceAccountKey(VALID_KEY_JSON);
    expect(() => new GcpAuth(key)).not.toThrow();
  });

  it("getAccessToken() rejects when network is unavailable (no real GCP)", async () => {
    const key = parseServiceAccountKey(VALID_KEY_JSON);
    const auth = new GcpAuth(key);

    // The key has a fake RSA key — createSign will fail with an RSA error.
    // Even if it somehow builds a JWT, the token exchange will fail (network/invalid key).
    // Either way, getAccessToken() must reject.
    await expect(auth.getAccessToken()).rejects.toThrow();
  });
});

describe("integration: GcpApiError (no Docker required)", () => {
  it("has name 'GcpApiError'", () => {
    const err = new GcpApiError(404, "not found");
    expect(err.name).toBe("GcpApiError");
  });

  it("has correct statusCode field", () => {
    const err = new GcpApiError(403, "forbidden");
    expect(err.statusCode).toBe(403);
  });

  it("has the provided message", () => {
    const err = new GcpApiError(500, "internal server error");
    expect(err.message).toBe("internal server error");
  });

  it("is instanceof Error", () => {
    const err = new GcpApiError(400, "bad request");
    expect(err).toBeInstanceOf(Error);
  });

  it("is instanceof GcpApiError", () => {
    const err = new GcpApiError(400, "bad request");
    expect(err).toBeInstanceOf(GcpApiError);
  });

  it("can be thrown and caught", () => {
    const fn = () => { throw new GcpApiError(429, "rate limited"); };
    expect(fn).toThrow(GcpApiError);
    expect(fn).toThrow("rate limited");
  });
});
