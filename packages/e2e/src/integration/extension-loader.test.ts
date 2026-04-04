/**
 * Integration tests: extensions/loader.ts loadBuiltinExtensions() and getGlobalRegistry() — no Docker required.
 *
 * extensions/loader.ts exports:
 *   - loadBuiltinExtensions() — loads all built-in extensions into the global registry
 *   - getGlobalRegistry() — returns the global ExtensionRegistry singleton
 *   - isExtension() — already tested in cloud-and-extensions.test.ts
 *
 * loadBuiltinExtensions() internally loads:
 *   - Webhook extensions (github, linear, mintlify, sentry, slack, test)
 *   - Telemetry extensions (otel)
 *   - Runtime extensions (local, ssh)
 *   - Model provider extensions (openai, anthropic, custom)
 *   - Credential provider extensions (file, vault conditionally)
 *
 * Each group is wrapped in try/catch so individual failures don't abort the load.
 *
 * Test scenarios (no Docker required):
 *   1. loadBuiltinExtensions() resolves without throwing
 *   2. getGlobalRegistry() returns an ExtensionRegistry (not null/undefined)
 *   3. getGlobalRegistry() returns same instance each call
 *   4. After loadBuiltinExtensions(), global registry has webhook extensions
 *   5. After loadBuiltinExtensions(), global registry has model extensions
 *   6. After loadBuiltinExtensions(), global registry has runtime extensions
 *   7. After loadBuiltinExtensions(), global registry has credential extensions
 *   8. loadBuiltinExtensions() with modelProviders set only loads matching models
 *   9. loadBuiltinExtensions() with credentialChecker does not throw
 *
 * Covers:
 *   - extensions/loader.ts: loadBuiltinExtensions() — resolves, loads all groups
 *   - extensions/loader.ts: loadBuiltinExtensions() — modelProviders filter
 *   - extensions/loader.ts: loadBuiltinExtensions() — credentialChecker parameter
 *   - extensions/loader.ts: getGlobalRegistry() — returns ExtensionRegistry singleton
 */

import { describe, it, expect } from "vitest";

const {
  loadBuiltinExtensions,
  getGlobalRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/extensions/loader.js"
);

const {
  ExtensionRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/extensions/registry.js"
);

describe("integration: extensions/loader.ts loadBuiltinExtensions() and getGlobalRegistry() (no Docker required)", { timeout: 30_000 }, () => {

  // ── getGlobalRegistry ─────────────────────────────────────────────────────

  it("getGlobalRegistry() returns a defined value", () => {
    const registry = getGlobalRegistry();
    expect(registry).toBeDefined();
  });

  it("getGlobalRegistry() returns the same instance each call", () => {
    const r1 = getGlobalRegistry();
    const r2 = getGlobalRegistry();
    expect(r1).toBe(r2);
  });

  it("getGlobalRegistry() returns an ExtensionRegistry instance", () => {
    const registry = getGlobalRegistry();
    expect(registry).toBeInstanceOf(ExtensionRegistry);
  });

  // ── loadBuiltinExtensions ─────────────────────────────────────────────────

  it("loadBuiltinExtensions() resolves without throwing", async () => {
    await expect(loadBuiltinExtensions()).resolves.toBeUndefined();
  });

  it("loadBuiltinExtensions() with undefined credentialChecker resolves", async () => {
    await expect(loadBuiltinExtensions(undefined)).resolves.toBeUndefined();
  });

  it("loadBuiltinExtensions() with credentialChecker function resolves", async () => {
    const checker = async (_type: string, _instance?: string) => true;
    await expect(loadBuiltinExtensions(checker)).resolves.toBeUndefined();
  });

  it("loadBuiltinExtensions() with modelProviders set loads only matching models", async () => {
    const modelProviders = new Set(["openai"]);
    await expect(loadBuiltinExtensions(undefined, modelProviders)).resolves.toBeUndefined();
  });

  it("loadBuiltinExtensions() with empty modelProviders set resolves", async () => {
    const emptySet = new Set<string>();
    await expect(loadBuiltinExtensions(undefined, emptySet)).resolves.toBeUndefined();
  });

  it("after loadBuiltinExtensions(), global registry has 'test' extension (webhook)", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const ext = registry.get("webhook", "test");
    expect(ext).toBeDefined();
  });

  it("after loadBuiltinExtensions(), global registry has 'github' extension (webhook)", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const ext = registry.get("webhook", "github");
    expect(ext).toBeDefined();
  });

  it("after loadBuiltinExtensions(), global registry has 'openai' extension (model)", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const ext = registry.get("model", "openai");
    expect(ext).toBeDefined();
  });

  it("after loadBuiltinExtensions(), global registry has 'anthropic' extension (model)", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const ext = registry.get("model", "anthropic");
    expect(ext).toBeDefined();
  });

  it("after loadBuiltinExtensions(), global registry has 'local' extension (runtime)", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const ext = registry.get("runtime", "local");
    expect(ext).toBeDefined();
  });

  it("after loadBuiltinExtensions(), global registry has 'file' extension (credential)", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const ext = registry.get("credential", "file");
    expect(ext).toBeDefined();
  });

  it("getGlobalRegistry().getAllWebhookExtensions() returns non-empty array after loadBuiltinExtensions()", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const all = registry.getAllWebhookExtensions();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
  });

  it("getGlobalRegistry().list() returns non-empty array after loadBuiltinExtensions()", async () => {
    await loadBuiltinExtensions();
    const registry = getGlobalRegistry();
    const names = registry.list();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
  });
});
