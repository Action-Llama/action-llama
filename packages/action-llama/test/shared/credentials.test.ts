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
  getDefaultBackend,
  resetDefaultBackend,
  sanitizeEnvPart,
  setDefaultBackend,
  listCredentialInstances,
} from "../../src/shared/credentials.js";
import { CREDENTIALS_DIR } from "../../src/shared/paths.js";

describe("credentials", () => {
  const testType = `test_cred_${Date.now()}`;
  const testInstance = "test";

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
    });

    it("parses colon syntax with default instance", () => {
      const result = parseCredentialRef("github_token:default");
      expect(result.type).toBe("github_token");
      expect(result.instance).toBe("default");
    });

    it("parses colon syntax with named instance", () => {
      const result = parseCredentialRef("git_ssh:botty");
      expect(result.type).toBe("git_ssh");
      expect(result.instance).toBe("botty");
    });

    it("trims whitespace", () => {
      const result = parseCredentialRef("  git_ssh : botty  ");
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
    it("resolves simple type to default instance", () => {
      const resolved = resolveAgentCredentials(["github_token"]);
      expect(resolved).toEqual([{ type: "github_token", instance: "default" }]);
    });

    it("resolves colon syntax to named instance", () => {
      const resolved = resolveAgentCredentials(["git_ssh:botty"]);
      expect(resolved).toEqual([{ type: "git_ssh", instance: "botty" }]);
    });

    it("resolves multiple refs", () => {
      const resolved = resolveAgentCredentials(["github_token", "git_ssh:botty", "sentry_token"]);
      expect(resolved).toEqual([
        { type: "github_token", instance: "default" },
        { type: "git_ssh", instance: "botty" },
        { type: "sentry_token", instance: "default" },
      ]);
    });
  });

  describe("listCredentialInstances", () => {
    it("returns an empty array when no instances exist for a credential type", async () => {
      const instances = await listCredentialInstances("nonexistent-cred-type-xyz");
      expect(Array.isArray(instances)).toBe(true);
      expect(instances).toHaveLength(0);
    });

    it("returns instances after writing a credential", async () => {
      await writeCredentialField("test-list-cred", "instance-a", "field1", "value1");
      const instances = await listCredentialInstances("test-list-cred");
      expect(instances).toContain("instance-a");
    });
  });

  describe("getDefaultBackend", () => {
    it("returns the current default credential backend", () => {
      const backend = getDefaultBackend();
      expect(backend).toBeDefined();
      expect(typeof backend.exists).toBe("function");
      expect(typeof backend.read).toBe("function");
    });
  });

  describe("resetDefaultBackend", () => {
    it("resets the backend to a new FilesystemBackend", () => {
      const mockBackend = {
        exists: async () => true,
        read: async () => "mock",
        readAll: async () => ({}),
        write: async () => {},
        writeAll: async () => {},
        listInstances: async () => [],
        list: async () => [],
      };

      setDefaultBackend(mockBackend as any);
      expect(getDefaultBackend()).toBe(mockBackend);

      resetDefaultBackend();

      // After reset, it should be a different backend (FilesystemBackend)
      const restoredBackend = getDefaultBackend();
      expect(restoredBackend).not.toBe(mockBackend);
      expect(typeof restoredBackend.exists).toBe("function");
    });
  });

  describe("sanitizeEnvPart", () => {
    it("returns alphanumeric strings unchanged", () => {
      expect(sanitizeEnvPart("github_token")).toBe("github_token");
      expect(sanitizeEnvPart("abc123")).toBe("abc123");
    });

    it("encodes hyphens", () => {
      expect(sanitizeEnvPart("my-instance")).toBe("my_x2dinstance");
    });

    it("encodes dots", () => {
      expect(sanitizeEnvPart("v1.0")).toBe("v1_x2e0");
    });

    it("encodes multiple special characters", () => {
      const encoded = sanitizeEnvPart("foo-bar.baz");
      expect(encoded).toBe("foo_x2dbar_x2ebaz");
    });

    it("does not encode underscores", () => {
      expect(sanitizeEnvPart("foo_bar")).toBe("foo_bar");
    });
  });
});
