import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock GcpAuth so we don't need real keys for validation tests
vi.mock("../../../src/cloud/gcp/auth.js", () => {
  function parseServiceAccountKey(json: string) {
    const key = JSON.parse(json);
    if (key.type !== "service_account") {
      throw new Error('JSON key type must be "service_account"');
    }
    if (!key.private_key || !key.client_email || !key.project_id) {
      throw new Error("JSON key missing required fields (private_key, client_email, project_id)");
    }
    return key;
  }

  class GcpAuth {
    constructor(_key: any) {}
    async getAccessToken() {
      return "mock-token";
    }
  }

  return { parseServiceAccountKey, GcpAuth };
});

import gcpServiceAccount from "../../../src/credentials/builtins/gcp-service-account.js";

const VALID_KEY = {
  type: "service_account",
  project_id: "my-project",
  private_key_id: "key123",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----",
  client_email: "test@my-project.iam.gserviceaccount.com",
  client_id: "12345",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};

describe("gcp_service_account credential", () => {
  describe("definition", () => {
    it("has correct id", () => {
      expect(gcpServiceAccount.id).toBe("gcp_service_account");
    });

    it("has a single field: key_json", () => {
      expect(gcpServiceAccount.fields).toHaveLength(1);
      expect(gcpServiceAccount.fields[0].name).toBe("key_json");
    });

    it("key_json field is marked secret", () => {
      expect(gcpServiceAccount.fields[0].secret).toBe(true);
    });

    it("has helpUrl pointing to cloud.google.com", () => {
      expect(gcpServiceAccount.helpUrl).toContain("cloud.google.com");
    });

    it("maps key_json to GOOGLE_APPLICATION_CREDENTIALS_JSON env var", () => {
      expect(gcpServiceAccount.envVars?.key_json).toBe("GOOGLE_APPLICATION_CREDENTIALS_JSON");
    });

    it("has a non-empty label", () => {
      expect(typeof gcpServiceAccount.label).toBe("string");
      expect(gcpServiceAccount.label.length).toBeGreaterThan(0);
    });

    it("has a non-empty description", () => {
      expect(typeof gcpServiceAccount.description).toBe("string");
      expect(gcpServiceAccount.description!.length).toBeGreaterThan(0);
    });

    it("has agentContext referencing GOOGLE_APPLICATION_CREDENTIALS_JSON", () => {
      expect(gcpServiceAccount.agentContext).toContain("GOOGLE_APPLICATION_CREDENTIALS_JSON");
    });
  });

  describe("validate", () => {
    it("succeeds with valid service account key JSON", async () => {
      const result = await gcpServiceAccount.validate!({ key_json: JSON.stringify(VALID_KEY) });
      expect(result).toBe(true);
    });

    it("throws on invalid JSON", async () => {
      await expect(
        gcpServiceAccount.validate!({ key_json: "not-json" }),
      ).rejects.toThrow("Invalid JSON");
    });

    it("throws when type is not service_account", async () => {
      const key = { ...VALID_KEY, type: "authorized_user" };
      await expect(
        gcpServiceAccount.validate!({ key_json: JSON.stringify(key) }),
      ).rejects.toThrow('JSON key type must be "service_account"');
    });

    it("throws when private_key is missing", async () => {
      const { private_key, ...key } = VALID_KEY;
      await expect(
        gcpServiceAccount.validate!({ key_json: JSON.stringify(key) }),
      ).rejects.toThrow("JSON key missing required fields");
    });

    it("throws when client_email is missing", async () => {
      const { client_email, ...key } = VALID_KEY;
      await expect(
        gcpServiceAccount.validate!({ key_json: JSON.stringify(key) }),
      ).rejects.toThrow("JSON key missing required fields");
    });

    it("throws when project_id is missing", async () => {
      const { project_id, ...key } = VALID_KEY;
      await expect(
        gcpServiceAccount.validate!({ key_json: JSON.stringify(key) }),
      ).rejects.toThrow("JSON key missing required fields");
    });
  });
});
