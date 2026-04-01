/**
 * Integration tests: credential utility functions — no Docker required.
 *
 * Tests pure and filesystem-based credential functions accessible via the
 * internals/credentials and internals/filesystem-backend exports:
 *
 *   parseCredentialRef():
 *     - "type" → {type, instance:"default"}
 *     - "type:instance" → {type, instance}
 *     - Whitespace trimming
 *
 *   sanitizeEnvPart() / unsanitizeEnvPart():
 *     - Alphanumeric passthrough
 *     - Special characters encoded/decoded
 *     - Roundtrip property
 *
 *   resolveAgentCredentials():
 *     - Maps array of refs to {type, instance} pairs
 *
 *   FilesystemBackend (static sync methods):
 *     - writeSync writes file; readSync reads it back; readAllSync reads all;
 *       existsSync returns correct value
 *
 * Covers:
 *   - shared/credentials.ts: parseCredentialRef(), sanitizeEnvPart(),
 *     unsanitizeEnvPart(), resolveAgentCredentials()
 *   - shared/filesystem-backend.ts: FilesystemBackend static methods
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseCredentialRef,
  sanitizeEnvPart,
  unsanitizeEnvPart,
  resolveAgentCredentials,
} from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-creds-test-"));
}

// ---------------------------------------------------------------------------
// parseCredentialRef
// ---------------------------------------------------------------------------

describe("credentials-utils: parseCredentialRef", { timeout: 10_000 }, () => {
  it("parses a simple type-only ref as instance 'default'", () => {
    const result = parseCredentialRef("github_token");
    expect(result.type).toBe("github_token");
    expect(result.instance).toBe("default");
  });

  it("parses a type:instance ref correctly", () => {
    const result = parseCredentialRef("git_ssh:botty");
    expect(result.type).toBe("git_ssh");
    expect(result.instance).toBe("botty");
  });

  it("trims whitespace from type and instance", () => {
    const result = parseCredentialRef("  anthropic_key : prod  ");
    expect(result.type).toBe("anthropic_key");
    expect(result.instance).toBe("prod");
  });

  it("handles a type with hyphens", () => {
    const result = parseCredentialRef("my-cred-type");
    expect(result.type).toBe("my-cred-type");
    expect(result.instance).toBe("default");
  });

  it("uses the part after the first colon as instance even if there are more colons", () => {
    // Only the first colon splits type vs instance
    const result = parseCredentialRef("some_type:inst:extra");
    expect(result.type).toBe("some_type");
    // Everything after the first colon (including extra colons) is the instance
    expect(result.instance).toBe("inst:extra");
  });
});

// ---------------------------------------------------------------------------
// sanitizeEnvPart / unsanitizeEnvPart
// ---------------------------------------------------------------------------

describe("credentials-utils: sanitizeEnvPart and unsanitizeEnvPart", { timeout: 10_000 }, () => {
  it("passes through alphanumeric and underscore characters unchanged", () => {
    expect(sanitizeEnvPart("github_token_123")).toBe("github_token_123");
  });

  it("encodes hyphen as _x2d", () => {
    expect(sanitizeEnvPart("git-ssh")).toBe("git_x2dssh");
  });

  it("encodes at-sign (@) in the result", () => {
    const sanitized = sanitizeEnvPart("user@host");
    expect(sanitized).not.toContain("@");
    expect(sanitized).toContain("_x40");
  });

  it("unsanitizeEnvPart decodes back to the original string", () => {
    const original = "git-ssh";
    const sanitized = sanitizeEnvPart(original);
    expect(unsanitizeEnvPart(sanitized)).toBe(original);
  });

  it("roundtrip for a string with multiple special characters", () => {
    const original = "user@host.example.com";
    const sanitized = sanitizeEnvPart(original);
    expect(unsanitizeEnvPart(sanitized)).toBe(original);
  });

  it("empty string passes through unchanged", () => {
    expect(sanitizeEnvPart("")).toBe("");
    expect(unsanitizeEnvPart("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// resolveAgentCredentials
// ---------------------------------------------------------------------------

describe("credentials-utils: resolveAgentCredentials", { timeout: 10_000 }, () => {
  it("maps an empty array to an empty array", () => {
    expect(resolveAgentCredentials([])).toEqual([]);
  });

  it("maps a single type-only ref to default instance", () => {
    const result = resolveAgentCredentials(["github_token"]);
    expect(result).toEqual([{ type: "github_token", instance: "default" }]);
  });

  it("maps a type:instance ref correctly", () => {
    const result = resolveAgentCredentials(["git_ssh:botty"]);
    expect(result).toEqual([{ type: "git_ssh", instance: "botty" }]);
  });

  it("maps multiple refs preserving order", () => {
    const result = resolveAgentCredentials(["anthropic_key", "github_token:ci", "git_ssh"]);
    expect(result).toEqual([
      { type: "anthropic_key", instance: "default" },
      { type: "github_token", instance: "ci" },
      { type: "git_ssh", instance: "default" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// FilesystemBackend (static sync methods)
// ---------------------------------------------------------------------------

describe("credentials-utils: FilesystemBackend static methods", { timeout: 10_000 }, () => {
  it("writeSync creates the credential file and readSync reads it back", () => {
    const dir = makeTempDir();
    FilesystemBackend.writeSync("github_token", "default", "token", "ghp-test-value", dir);

    const value = FilesystemBackend.readSync("github_token", "default", "token", dir);
    expect(value).toBe("ghp-test-value");
  });

  it("readSync returns undefined for a non-existent credential", () => {
    const dir = makeTempDir();
    const value = FilesystemBackend.readSync("nonexistent_type", "default", "token", dir);
    expect(value).toBeUndefined();
  });

  it("existsSync returns false when credential directory is missing", () => {
    const dir = makeTempDir();
    expect(FilesystemBackend.existsSync("missing_type", "default", dir)).toBe(false);
  });

  it("existsSync returns true after writing a credential", () => {
    const dir = makeTempDir();
    FilesystemBackend.writeSync("anthropic_key", "default", "token", "sk-test", dir);
    expect(FilesystemBackend.existsSync("anthropic_key", "default", dir)).toBe(true);
  });

  it("readAllSync returns all fields for a credential instance", () => {
    const dir = makeTempDir();
    FilesystemBackend.writeSync("git_ssh", "default", "id_rsa", "PRIVATE_KEY_CONTENT", dir);
    FilesystemBackend.writeSync("git_ssh", "default", "email", "user@example.com", dir);

    const all = FilesystemBackend.readAllSync("git_ssh", "default", dir);
    expect(all).toBeDefined();
    expect(all!.id_rsa).toBe("PRIVATE_KEY_CONTENT");
    expect(all!.email).toBe("user@example.com");
  });

  it("readAllSync returns undefined when credential directory is missing", () => {
    const dir = makeTempDir();
    const all = FilesystemBackend.readAllSync("nonexistent", "default", dir);
    expect(all).toBeUndefined();
  });
});
