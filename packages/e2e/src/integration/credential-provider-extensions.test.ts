/**
 * Integration tests: credentials/providers/index.ts — no Docker required.
 *
 * credentials/providers/index.ts exports two CredentialExtension objects:
 *   1. fileCredentialExtension — File-based credential provider
 *   2. vaultCredentialExtension — HashiCorp Vault credential provider
 *
 * These extension objects are loaded by loadBuiltinExtensions() during scheduler
 * startup. The extension metadata and init/shutdown lifecycle are tested here
 * without any network or Docker access.
 *
 * Note: vaultCredentialExtension.init() throws when Vault is unreachable,
 * so we test the metadata and shutdown() only for Vault (matching the
 * scheduler behavior of skipping Vault when VAULT_ADDR is not set).
 *
 * Test scenarios (no Docker required):
 *   1. fileCredentialExtension metadata.name is 'file'
 *   2. fileCredentialExtension metadata.type is 'credential'
 *   3. fileCredentialExtension metadata.requiredCredentials is empty
 *   4. fileCredentialExtension has provider instance
 *   5. fileCredentialExtension init() does not throw
 *   6. fileCredentialExtension shutdown() does not throw
 *   7. vaultCredentialExtension metadata.name is 'vault'
 *   8. vaultCredentialExtension metadata.type is 'credential'
 *   9. vaultCredentialExtension metadata.requiredCredentials has vault_addr, vault_token
 *  10. vaultCredentialExtension metadata.providesCredentialTypes includes vault_addr and vault_token
 *  11. vaultCredentialExtension has provider instance
 *  12. vaultCredentialExtension shutdown() does not throw
 *  13. Both extensions are defined and distinct
 *
 * Covers:
 *   - credentials/providers/index.ts: fileCredentialExtension — metadata + init + shutdown
 *   - credentials/providers/index.ts: vaultCredentialExtension — metadata + shutdown
 *   - credentials/providers/index.ts: module exports both extension objects
 */

import { describe, it, expect } from "vitest";

const {
  fileCredentialExtension,
  vaultCredentialExtension,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/credentials/providers/index.js"
);

describe("integration: credentials/providers/index.ts (no Docker required)", { timeout: 30_000 }, () => {

  // ── fileCredentialExtension ───────────────────────────────────────────────

  it("fileCredentialExtension is defined", () => {
    expect(fileCredentialExtension).toBeDefined();
  });

  it("fileCredentialExtension metadata.name is 'file'", () => {
    expect(fileCredentialExtension.metadata.name).toBe("file");
  });

  it("fileCredentialExtension metadata.type is 'credential'", () => {
    expect(fileCredentialExtension.metadata.type).toBe("credential");
  });

  it("fileCredentialExtension metadata.version is defined", () => {
    expect(typeof fileCredentialExtension.metadata.version).toBe("string");
  });

  it("fileCredentialExtension metadata.description is non-empty", () => {
    expect(fileCredentialExtension.metadata.description).toBeTruthy();
  });

  it("fileCredentialExtension metadata.requiredCredentials is empty", () => {
    const creds = fileCredentialExtension.metadata.requiredCredentials || [];
    expect(Array.isArray(creds)).toBe(true);
    expect(creds.length).toBe(0);
  });

  it("fileCredentialExtension provider is defined", () => {
    expect(fileCredentialExtension.provider).toBeDefined();
  });

  it("fileCredentialExtension init() does not throw", async () => {
    await expect(fileCredentialExtension.init()).resolves.toBeUndefined();
  });

  it("fileCredentialExtension shutdown() does not throw", async () => {
    await expect(fileCredentialExtension.shutdown()).resolves.toBeUndefined();
  });

  // ── vaultCredentialExtension ──────────────────────────────────────────────

  it("vaultCredentialExtension is defined", () => {
    expect(vaultCredentialExtension).toBeDefined();
  });

  it("vaultCredentialExtension metadata.name is 'vault'", () => {
    expect(vaultCredentialExtension.metadata.name).toBe("vault");
  });

  it("vaultCredentialExtension metadata.type is 'credential'", () => {
    expect(vaultCredentialExtension.metadata.type).toBe("credential");
  });

  it("vaultCredentialExtension metadata.version is defined", () => {
    expect(typeof vaultCredentialExtension.metadata.version).toBe("string");
  });

  it("vaultCredentialExtension metadata.requiredCredentials has vault_addr and vault_token", () => {
    const creds = vaultCredentialExtension.metadata.requiredCredentials || [];
    expect(creds.some((c: any) => c.type === "vault_addr")).toBe(true);
    expect(creds.some((c: any) => c.type === "vault_token")).toBe(true);
  });

  it("vaultCredentialExtension metadata.providesCredentialTypes includes vault_addr", () => {
    const types = vaultCredentialExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "vault_addr")).toBe(true);
  });

  it("vaultCredentialExtension metadata.providesCredentialTypes includes vault_token", () => {
    const types = vaultCredentialExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "vault_token")).toBe(true);
  });

  it("vaultCredentialExtension provider is defined", () => {
    expect(vaultCredentialExtension.provider).toBeDefined();
  });

  it("vaultCredentialExtension shutdown() does not throw", async () => {
    await expect(vaultCredentialExtension.shutdown()).resolves.toBeUndefined();
  });

  // Note: init() is NOT tested because it requires a real Vault server (throws when unavailable)

  // ── Both extensions ───────────────────────────────────────────────────────

  it("both extensions are defined and distinct", () => {
    expect(fileCredentialExtension).toBeDefined();
    expect(vaultCredentialExtension).toBeDefined();
    expect(fileCredentialExtension).not.toBe(vaultCredentialExtension);
  });
});
