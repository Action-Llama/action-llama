import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { parseServiceAccountKey, GcpAuth } from "../../../src/cloud/gcp/auth.js";

const VALID_KEY_JSON = JSON.stringify({
  type: "service_account",
  project_id: "my-project",
  private_key_id: "key123",
  private_key: `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtEsHALsaDtOuKRvWBiQNGHSg
PLACEHOLDER_FOR_TESTS_ONLY
-----END RSA PRIVATE KEY-----`,
  client_email: "test@my-project.iam.gserviceaccount.com",
  client_id: "12345",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
});

function mockTokenResponse(accessToken = "test-token", expiresIn = 3600) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ access_token: accessToken, expires_in: expiresIn })),
    json: () => Promise.resolve({ access_token: accessToken, expires_in: expiresIn }),
  };
}

describe("parseServiceAccountKey", () => {
  it("parses a valid key JSON", () => {
    const key = parseServiceAccountKey(VALID_KEY_JSON);
    expect(key.type).toBe("service_account");
    expect(key.project_id).toBe("my-project");
    expect(key.client_email).toBe("test@my-project.iam.gserviceaccount.com");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseServiceAccountKey("not-json")).toThrow("Invalid JSON");
  });

  it("throws when type is not service_account", () => {
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
});

describe("GcpAuth", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("requests a token from the OAuth2 endpoint", async () => {
    // Use a real RSA key for actual signing
    const { generateKeyPairSync } = await import("crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pemKey = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

    const keyJson = JSON.stringify({
      type: "service_account",
      project_id: "my-project",
      private_key_id: "key123",
      private_key: pemKey,
      client_email: "test@my-project.iam.gserviceaccount.com",
      client_id: "12345",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    });

    mockFetch.mockResolvedValueOnce(mockTokenResponse("my-access-token"));

    const key = parseServiceAccountKey(keyJson);
    const auth = new GcpAuth(key);
    const token = await auth.getAccessToken();

    expect(token).toBe("my-access-token");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
  });

  it("caches the token and does not re-request within expiry window", async () => {
    const { generateKeyPairSync } = await import("crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pemKey = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

    const keyJson = JSON.stringify({
      type: "service_account",
      project_id: "my-project",
      private_key_id: "key123",
      private_key: pemKey,
      client_email: "test@my-project.iam.gserviceaccount.com",
      client_id: "12345",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    });

    mockFetch.mockResolvedValue(mockTokenResponse("cached-token", 3600));

    const key = parseServiceAccountKey(keyJson);
    const auth = new GcpAuth(key);

    const t1 = await auth.getAccessToken();
    const t2 = await auth.getAccessToken();

    expect(t1).toBe("cached-token");
    expect(t2).toBe("cached-token");
    // Should only have called fetch once (second call uses cache)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws when token endpoint returns an error", async () => {
    const { generateKeyPairSync } = await import("crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pemKey = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

    const keyJson = JSON.stringify({
      type: "service_account",
      project_id: "my-project",
      private_key_id: "key123",
      private_key: pemKey,
      client_email: "test@my-project.iam.gserviceaccount.com",
      client_id: "12345",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    const key = parseServiceAccountKey(keyJson);
    const auth = new GcpAuth(key);

    await expect(auth.getAccessToken()).rejects.toThrow("GCP token exchange failed (HTTP 401)");
  });
});
