/**
 * Integration tests: credential backend pipeline — no Docker required.
 *
 * Tests the async credential API (loadCredentialField, writeCredentialField,
 * credentialExists, listCredentialInstances, requireCredentialRef) using a
 * temporary FilesystemBackend pointed at a temp directory.
 *
 * The setDefaultBackend / resetDefaultBackend pattern is the same used by
 * the IntegrationHarness.
 *
 * Covers:
 *   - shared/credentials.ts: loadCredentialField(), writeCredentialField(),
 *     loadCredentialFields(), writeCredentialFields(), credentialExists(),
 *     listCredentialInstances(), requireCredentialRef()
 *   - shared/filesystem-backend.ts: FilesystemBackend async methods (read,
 *     write, readAll, writeAll, exists, listInstances)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  setDefaultBackend,
  resetDefaultBackend,
  loadCredentialField,
  writeCredentialField,
  loadCredentialFields,
  writeCredentialFields,
  credentialExists,
  listCredentialInstances,
  requireCredentialRef,
} from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-cred-backend-test-"));
}

describe("credential-backend: async credential API via FilesystemBackend", { timeout: 10_000 }, () => {
  afterEach(() => {
    resetDefaultBackend();
  });

  it("writeCredentialField then loadCredentialField returns written value", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    await writeCredentialField("anthropic_key", "default", "token", "sk-test-value");
    const value = await loadCredentialField("anthropic_key", "default", "token");

    expect(value).toBe("sk-test-value");
  });

  it("loadCredentialField returns undefined for non-existent credential", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    const value = await loadCredentialField("nonexistent", "default", "token");
    expect(value).toBeUndefined();
  });

  it("credentialExists returns false before writing", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    const exists = await credentialExists("github_token", "default");
    expect(exists).toBe(false);
  });

  it("credentialExists returns true after writing", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    await writeCredentialField("github_token", "default", "token", "ghp-test");
    const exists = await credentialExists("github_token", "default");

    expect(exists).toBe(true);
  });

  it("writeCredentialFields then loadCredentialFields returns all fields", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    await writeCredentialFields("git_ssh", "botty", {
      id_rsa: "PRIVATE_KEY",
      email: "botty@example.com",
    });

    const fields = await loadCredentialFields("git_ssh", "botty");
    expect(fields).toBeDefined();
    expect(fields!.id_rsa).toBe("PRIVATE_KEY");
    expect(fields!.email).toBe("botty@example.com");
  });

  it("loadCredentialFields returns undefined for non-existent instance", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    const fields = await loadCredentialFields("nonexistent", "default");
    expect(fields).toBeUndefined();
  });

  it("listCredentialInstances returns empty array when no instances exist", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    const instances = await listCredentialInstances("github_token");
    expect(instances).toEqual([]);
  });

  it("listCredentialInstances returns instance names after writing", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    await writeCredentialField("github_token", "main", "token", "ghp-main");
    await writeCredentialField("github_token", "ci", "token", "ghp-ci");

    const instances = await listCredentialInstances("github_token");
    expect(instances.sort()).toEqual(["ci", "main"]);
  });

  it("requireCredentialRef resolves when credential exists", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    await writeCredentialField("anthropic_key", "default", "token", "sk-test");
    // Should not throw
    await expect(requireCredentialRef("anthropic_key")).resolves.toBeUndefined();
  });

  it("requireCredentialRef throws CredentialError when credential is missing", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    await expect(requireCredentialRef("missing_cred")).rejects.toThrow(
      /missing_cred|not found|al doctor/i,
    );
  });

  it("requireCredentialRef parses type:instance refs correctly", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    await writeCredentialField("git_ssh", "botty", "id_rsa", "PRIVATE_KEY");
    // Should resolve for git_ssh:botty
    await expect(requireCredentialRef("git_ssh:botty")).resolves.toBeUndefined();
    // Should throw for git_ssh:other (different instance)
    await expect(requireCredentialRef("git_ssh:other")).rejects.toThrow(/not found/i);
  });
});
