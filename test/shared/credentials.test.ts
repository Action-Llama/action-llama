import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Use real file system with a temp CREDENTIALS_DIR
let tmpDir: string;

// We can't easily mock the const CREDENTIALS_DIR, so test the logic
// using the real functions against a predictable file layout.
// Instead, test through the state module pattern (temp dirs).

import { loadCredential, requireCredential, writeCredential } from "../../src/shared/credentials.js";
import { CREDENTIALS_DIR } from "../../src/shared/paths.js";

describe("credentials", () => {
  describe("loadCredential", () => {
    it("returns undefined when file does not exist", () => {
      expect(loadCredential("nonexistent-test-credential-xyz")).toBeUndefined();
    });
  });

  describe("requireCredential", () => {
    it("throws when credential is missing", () => {
      expect(() => requireCredential("nonexistent-test-credential-xyz")).toThrow(
        'Credential "nonexistent-test-credential-xyz" not found'
      );
    });
  });

  describe("writeCredential + loadCredential roundtrip", () => {
    const testName = `test-cred-${Date.now()}`;

    afterEach(() => {
      // Clean up the test credential
      try {
        const { unlinkSync } = require("fs");
        unlinkSync(resolve(CREDENTIALS_DIR, testName));
      } catch {}
    });

    it("writes and reads back credential", () => {
      writeCredential(testName, "my-secret-value");
      const loaded = loadCredential(testName);
      expect(loaded).toBe("my-secret-value");
    });
  });
});
