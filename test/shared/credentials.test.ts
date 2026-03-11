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
    it("parses type:instance", () => {
      expect(parseCredentialRef("github_token:default")).toEqual({ type: "github_token", instance: "default" });
    });

    it("defaults instance to 'default' when no colon", () => {
      expect(parseCredentialRef("github_token")).toEqual({ type: "github_token", instance: "default" });
    });

    it("handles named instances", () => {
      expect(parseCredentialRef("git_ssh:botty")).toEqual({ type: "git_ssh", instance: "botty" });
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
});
