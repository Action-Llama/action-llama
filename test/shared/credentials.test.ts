import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "fs";
import { resolve } from "path";

import {
  loadCredentialField,
  writeCredentialField,
  writeCredentialFields,
  loadCredentialFields,
  credentialExists,
  parseCredentialRef,
  requireCredentialRef,
  resolveAgentCredentials,
  suppressLegacyWarning,
} from "../../src/shared/credentials.js";
import { CREDENTIALS_DIR } from "../../src/shared/paths.js";

describe("credentials", () => {
  const testType = `test_cred_${Date.now()}`;
  const testInstance = "test";

  // Suppress legacy deprecation warnings in tests
  suppressLegacyWarning(true);

  afterEach(() => {
    try {
      rmSync(resolve(CREDENTIALS_DIR, testType), { recursive: true, force: true });
    } catch {}
  });

  describe("parseCredentialRef", () => {
    it("parses simple type ref", () => {
      const result = parseCredentialRef("github_token");
      expect(result.type).toBe("github_token");
      expect(result.instance).toBe("default");
      expect(result.agentRef).toBeUndefined();
    });

    it("parses cross-agent reference with slash", () => {
      const result = parseCredentialRef("other-agent/github_token");
      expect(result.type).toBe("github_token");
      expect(result.agentRef).toBe("other-agent");
    });

    it("parses legacy colon syntax (backwards compatible)", () => {
      const result = parseCredentialRef("github_token:default");
      expect(result.type).toBe("github_token");
      expect(result.instance).toBe("default");
    });

    it("parses legacy named instance (backwards compatible)", () => {
      const result = parseCredentialRef("git_ssh:botty");
      expect(result.type).toBe("git_ssh");
      expect(result.instance).toBe("botty");
    });
  });

  describe("writeCredentialField + loadCredentialField roundtrip", () => {
    it("writes and reads back a field", async () => {
      await writeCredentialField(testType, testInstance, "token", "my-secret-value");
      const loaded = await loadCredentialField(testType, testInstance, "token");
      expect(loaded).toBe("my-secret-value");
    });
  });

  describe("writeCredentialFields + loadCredentialFields", () => {
    it("writes and reads back multiple fields", async () => {
      await writeCredentialFields(testType, testInstance, {
        id_rsa: "ssh-key-content",
        username: "Bot",
        email: "bot@example.com",
      });
      const fields = await loadCredentialFields(testType, testInstance);
      expect(fields).toEqual({
        id_rsa: "ssh-key-content",
        username: "Bot",
        email: "bot@example.com",
      });
    });
  });

  describe("credentialExists", () => {
    it("returns false for non-existent credential", async () => {
      expect(await credentialExists(testType, "nonexistent")).toBe(false);
    });

    it("returns true after writing", async () => {
      await writeCredentialField(testType, testInstance, "token", "value");
      expect(await credentialExists(testType, testInstance)).toBe(true);
    });
  });

  describe("requireCredentialRef", () => {
    it("throws for missing credential", async () => {
      await expect(requireCredentialRef("nonexistent_type:missing")).rejects.toThrow("not found");
    });
  });

  describe("loadCredentialField", () => {
    it("returns undefined when field does not exist", async () => {
      expect(await loadCredentialField(testType, testInstance, "nonexistent")).toBeUndefined();
    });
  });

  describe("resolveAgentCredentials", () => {
    const resolveType = `resolve_cred_${Date.now()}`;

    afterEach(() => {
      try {
        rmSync(resolve(CREDENTIALS_DIR, resolveType), { recursive: true, force: true });
      } catch {}
    });

    it("falls back to default when no agent-specific credential", async () => {
      await writeCredentialField(resolveType, "default", "token", "shared-value");

      const resolved = await resolveAgentCredentials("my-agent", [resolveType]);
      expect(resolved).toEqual([{ type: resolveType, instance: "default" }]);
    });

    it("uses agent-specific credential when it exists", async () => {
      await writeCredentialField(resolveType, "default", "token", "shared-value");
      await writeCredentialField(resolveType, "my-agent", "token", "agent-value");

      const resolved = await resolveAgentCredentials("my-agent", [resolveType]);
      expect(resolved).toEqual([{ type: resolveType, instance: "my-agent" }]);
    });

    it("resolves cross-agent references", async () => {
      await writeCredentialField(resolveType, "other-agent", "token", "other-value");

      const resolved = await resolveAgentCredentials("my-agent", [`other-agent/${resolveType}`]);
      expect(resolved).toEqual([{ type: resolveType, instance: "other-agent" }]);
    });

    it("cross-agent ref falls back to default when agent-specific not found", async () => {
      await writeCredentialField(resolveType, "default", "token", "shared-value");

      const resolved = await resolveAgentCredentials("my-agent", [`nonexistent-agent/${resolveType}`]);
      expect(resolved).toEqual([{ type: resolveType, instance: "default" }]);
    });
  });
});
