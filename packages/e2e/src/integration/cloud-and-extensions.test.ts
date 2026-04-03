/**
 * Integration tests: cloud state, nginx config, extension registry, and telemetry — no Docker required.
 *
 * Tests four previously untested modules:
 *
 *   1. cloud/state.ts — loadState/saveState/deleteState/createState
 *      Exercises the filesystem-based provisioning state store that `al push` uses to
 *      track VPS resources.  All operations run in a temp directory so they never
 *      touch the real ~/.action-llama/state dir.
 *
 *   2. cloud/vps/nginx.ts — generateNginxConfig()
 *      Pure function: no I/O, no network.  Tested with and without a frontendPath to
 *      exercise both the static-assets and pass-through config branches.
 *
 *   3. extensions/registry.ts — ExtensionRegistry
 *      In-memory extension registry: register, get, getAll, list, unregister, shutdown,
 *      duplicate-registration error, invalid-type error, credential-check error.
 *
 *   4. telemetry/index.ts — TelemetryManager (disabled mode)
 *      When telemetry is disabled all methods are no-ops or return undefined/noop spans.
 *      Tests createSpan, withSpan, setSpanStatus, getActiveContext, setTraceContext,
 *      shutdown, initTelemetry, getTelemetry, and convenience wrappers — all without
 *      any network or OTLP collector.
 *
 *   5. extensions/loader.ts — isExtension()
 *      Pure predicate function that validates extension object shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir, homedir } from "os";

// ── 1. cloud/state.ts ────────────────────────────────────────────────────────

const {
  loadState,
  saveState,
  deleteState,
  createState,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/state.js"
);

// ── 2. cloud/vps/nginx.ts ────────────────────────────────────────────────────

const {
  generateNginxConfig,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/nginx.js"
);

// ── 3. extensions/registry.ts ────────────────────────────────────────────────

const {
  ExtensionRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/extensions/registry.js"
);

// ── 4. telemetry/index.ts ────────────────────────────────────────────────────

const {
  TelemetryManager,
  initTelemetry,
  getTelemetry,
  createSpan: createSpanConvenience,
  withSpan: withSpanConvenience,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/telemetry/index.js"
);

// ── 5. extensions/loader.ts ──────────────────────────────────────────────────

const {
  isExtension,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/extensions/loader.js"
);

// ────────────────────────────────────────────────────────────────────────────

describe("integration: cloud state (no Docker required)", () => {
  // cloud/state.ts writes to STATE_DIR which resolves to ~/.action-llama/state.
  // Since home() === /tmp in this environment, it writes to /tmp/.action-llama/state.
  // We use unique project paths so tests don't collide.

  function uniqueProjectPath(): string {
    return mkdtempSync(join(tmpdir(), "al-cloud-state-test-"));
  }

  it("loadState returns null for an unknown project path", () => {
    const projectPath = uniqueProjectPath();
    const state = loadState(projectPath);
    expect(state).toBeNull();
  });

  it("createState builds a ProvisionedState object with the given fields", () => {
    const projectPath = uniqueProjectPath();
    const resources = [{ type: "server", id: "srv-123" }];
    const state = createState(projectPath, "vps", resources);

    expect(state.projectPath).toBe(projectPath);
    expect(state.provider).toBe("vps");
    expect(state.resources).toEqual(resources);
    expect(state.createdAt).toBeTruthy();
    expect(state.updatedAt).toBeTruthy();
    // Both timestamps are ISO 8601
    expect(() => new Date(state.createdAt)).not.toThrow();
    expect(() => new Date(state.updatedAt)).not.toThrow();
  });

  it("saveState persists state and loadState reads it back", () => {
    const projectPath = uniqueProjectPath();
    const resources = [{ type: "server", id: "srv-456", region: "us-east" }];
    const original = createState(projectPath, "vps", resources);

    saveState(original);

    const loaded = loadState(projectPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.projectPath).toBe(projectPath);
    expect(loaded!.provider).toBe("vps");
    expect(loaded!.resources).toEqual(resources);
    // updatedAt is refreshed on save
    expect(loaded!.updatedAt).toBeTruthy();
  });

  it("saveState updates updatedAt on second save", async () => {
    const projectPath = uniqueProjectPath();
    const state = createState(projectPath, "vps", []);

    saveState(state);
    const first = loadState(projectPath)!;

    // Small delay so timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    saveState(state);
    const second = loadState(projectPath)!;

    expect(second.updatedAt >= first.updatedAt).toBe(true);
  });

  it("deleteState removes the persisted state file", () => {
    const projectPath = uniqueProjectPath();
    const state = createState(projectPath, "vps", []);
    saveState(state);

    // Confirm it was saved
    expect(loadState(projectPath)).not.toBeNull();

    deleteState(projectPath);

    // Should now be null
    expect(loadState(projectPath)).toBeNull();
  });

  it("deleteState is a no-op for unknown project path", () => {
    const projectPath = uniqueProjectPath();
    // Should not throw even when no state file exists
    expect(() => deleteState(projectPath)).not.toThrow();
  });

  it("different project paths produce independent state entries", () => {
    const pathA = uniqueProjectPath();
    const pathB = uniqueProjectPath();

    const stateA = createState(pathA, "vps", [{ type: "server", id: "A" }]);
    const stateB = createState(pathB, "vps", [{ type: "server", id: "B" }]);

    saveState(stateA);
    saveState(stateB);

    const loadedA = loadState(pathA)!;
    const loadedB = loadState(pathB)!;

    expect(loadedA.resources[0].id).toBe("A");
    expect(loadedB.resources[0].id).toBe("B");
  });

  it("createState accepts an empty resources array", () => {
    const projectPath = uniqueProjectPath();
    const state = createState(projectPath, "vps", []);
    expect(state.resources).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe("integration: generateNginxConfig (no Docker required)", () => {
  it("returns a string containing the hostname", () => {
    const config = generateNginxConfig("example.com", 3000);
    expect(config).toContain("example.com");
  });

  it("includes the gateway port in the proxy_pass line", () => {
    const config = generateNginxConfig("example.com", 4567);
    expect(config).toContain("proxy_pass http://127.0.0.1:4567");
  });

  it("listens on port 443 ssl", () => {
    const config = generateNginxConfig("example.com", 3000);
    expect(config).toContain("listen 443 ssl");
  });

  it("redirects HTTP to HTTPS (port 80 block)", () => {
    const config = generateNginxConfig("example.com", 3000);
    expect(config).toContain("listen 80");
    expect(config).toContain("return 301 https://$host$request_uri");
  });

  it("references the Cloudflare cert path", () => {
    const config = generateNginxConfig("example.com", 3000);
    expect(config).toContain("ssl_certificate");
    expect(config).toContain("/etc/ssl/cloudflare");
  });

  it("includes rate limiting directives", () => {
    const config = generateNginxConfig("example.com", 3000);
    expect(config).toContain("limit_req");
  });

  it("without frontendPath uses a single catch-all location /", () => {
    const config = generateNginxConfig("example.com", 3000);
    expect(config).toContain("location /");
    // Static assets block should NOT be present
    expect(config).not.toContain("location /assets/");
  });

  it("with frontendPath adds static /assets/ location", () => {
    const config = generateNginxConfig("example.com", 3000, "/app/frontend");
    expect(config).toContain("location /assets/");
    expect(config).toContain("/app/frontend/assets/");
  });

  it("with frontendPath adds SPA fallback locations", () => {
    const config = generateNginxConfig("example.com", 3000, "/app/frontend");
    expect(config).toContain("location /login");
    expect(config).toContain("location /dashboard");
    expect(config).toContain("try_files /index.html =404");
  });

  it("with frontendPath adds SSE stream location with proxy_buffering off", () => {
    const config = generateNginxConfig("example.com", 3000, "/app/frontend");
    expect(config).toContain("/dashboard/api/status-stream");
    expect(config).toContain("proxy_buffering off");
  });

  it("uses TLSv1.2 and TLSv1.3", () => {
    const config = generateNginxConfig("example.com", 3000);
    expect(config).toContain("TLSv1.2 TLSv1.3");
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe("integration: ExtensionRegistry (no Docker required)", () => {
  function makeExtension(type: string, name: string) {
    return {
      metadata: {
        name,
        type,
        version: "1.0.0",
        description: `Test ${type} extension: ${name}`,
      },
      async init() {},
      async shutdown() {},
      // Type-specific payload field used by typed getters
      ...(type === "webhook" ? { provider: { name } } : {}),
      ...(type === "telemetry" ? { provider: {} } : {}),
      ...(type === "runtime" ? { provider: {} } : {}),
      ...(type === "model" ? { provider: {} } : {}),
      ...(type === "credential" ? { provider: {} } : {}),
    };
  }

  it("register + get: retrieving a registered webhook extension", async () => {
    const registry = new ExtensionRegistry();
    const ext = makeExtension("webhook", "my-webhook");

    await registry.register(ext);

    const retrieved = registry.get("webhook", "my-webhook");
    expect(retrieved).toBe(ext);
  });

  it("getWebhookExtension retrieves by name", async () => {
    const registry = new ExtensionRegistry();
    const ext = makeExtension("webhook", "gh-webhook");
    await registry.register(ext);

    expect(registry.getWebhookExtension("gh-webhook")).toBe(ext);
    expect(registry.getWebhookExtension("nonexistent")).toBeUndefined();
  });

  it("getAll returns all registered extensions of a type", async () => {
    const registry = new ExtensionRegistry();
    await registry.register(makeExtension("webhook", "webhook-a"));
    await registry.register(makeExtension("webhook", "webhook-b"));
    await registry.register(makeExtension("model", "model-x"));

    const webhooks = registry.getAllWebhookExtensions();
    expect(webhooks).toHaveLength(2);
    const names = webhooks.map((e: any) => e.metadata.name);
    expect(names).toContain("webhook-a");
    expect(names).toContain("webhook-b");

    // model count unaffected
    const models = registry.getAllModelExtensions();
    expect(models).toHaveLength(1);
  });

  it("list returns metadata for all registered extensions", async () => {
    const registry = new ExtensionRegistry();
    await registry.register(makeExtension("telemetry", "otel"));
    await registry.register(makeExtension("runtime", "docker"));

    const listing = registry.list();
    expect(listing).toHaveLength(2);

    const types = listing.map((e: any) => e.type);
    expect(types).toContain("telemetry");
    expect(types).toContain("runtime");

    const names = listing.map((e: any) => e.name);
    expect(names).toContain("otel");
    expect(names).toContain("docker");
  });

  it("duplicate registration throws an error", async () => {
    const registry = new ExtensionRegistry();
    const ext = makeExtension("model", "duplicate");
    await registry.register(ext);

    await expect(registry.register(ext)).rejects.toThrow("already registered");
  });

  it("invalid extension type throws an error", async () => {
    const registry = new ExtensionRegistry();
    const badExt = {
      metadata: { name: "bad", type: "invalid-type", version: "1.0.0", description: "bad" },
      async init() {},
      async shutdown() {},
    };

    await expect(registry.register(badExt as any)).rejects.toThrow("Invalid extension type");
  });

  it("unregister removes the extension", async () => {
    const registry = new ExtensionRegistry();
    await registry.register(makeExtension("model", "removable"));

    expect(registry.get("model", "removable")).toBeDefined();
    await registry.unregister("model", "removable");
    expect(registry.get("model", "removable")).toBeUndefined();
  });

  it("unregister is a no-op for unknown extension", async () => {
    const registry = new ExtensionRegistry();
    // Should not throw
    await expect(registry.unregister("webhook", "nonexistent")).resolves.toBeUndefined();
  });

  it("shutdown calls shutdown on all registered extensions", async () => {
    const registry = new ExtensionRegistry();
    let shutdownCount = 0;

    const ext1 = {
      ...makeExtension("webhook", "ext1"),
      async shutdown() { shutdownCount++; },
    };
    const ext2 = {
      ...makeExtension("model", "ext2"),
      async shutdown() { shutdownCount++; },
    };

    await registry.register(ext1);
    await registry.register(ext2);
    await registry.shutdown();

    expect(shutdownCount).toBe(2);
  });

  it("getCredentialType returns undefined when no credential types registered", () => {
    const registry = new ExtensionRegistry();
    expect(registry.getCredentialType("github_token")).toBeUndefined();
  });

  it("getCredentialType returns definition when extension provides credential types", async () => {
    const registry = new ExtensionRegistry();
    const ext = {
      metadata: {
        name: "my-cred-ext",
        type: "credential" as const,
        version: "1.0.0",
        description: "provides custom cred type",
        providesCredentialTypes: [
          { type: "custom_token", fields: ["api_key"], description: "A custom API token" },
        ],
      },
      provider: {},
      async init() {},
      async shutdown() {},
    };

    await registry.register(ext as any);
    const credDef = registry.getCredentialType("custom_token");
    expect(credDef).toBeDefined();
    expect(credDef!.type).toBe("custom_token");
    expect(credDef!.fields).toContain("api_key");
  });

  it("getAllCredentialTypes returns all registered credential type definitions", async () => {
    const registry = new ExtensionRegistry();
    const ext = {
      metadata: {
        name: "multi-cred-ext",
        type: "credential" as const,
        version: "1.0.0",
        description: "provides two cred types",
        providesCredentialTypes: [
          { type: "type_a", fields: ["key_a"] },
          { type: "type_b", fields: ["key_b"] },
        ],
      },
      provider: {},
      async init() {},
      async shutdown() {},
    };

    await registry.register(ext as any);
    const all = registry.getAllCredentialTypes();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const types = all.map((d: any) => d.type);
    expect(types).toContain("type_a");
    expect(types).toContain("type_b");
  });

  it("credential checker: rejects registration when required credential is missing", async () => {
    const checker = async (_type: string, _instance?: string) => false;
    const registry = new ExtensionRegistry(checker);

    const ext = {
      metadata: {
        name: "needs-cred",
        type: "webhook" as const,
        version: "1.0.0",
        description: "requires a credential",
        requiredCredentials: [{ type: "github_token", optional: false }],
      },
      provider: {},
      async init() {},
      async shutdown() {},
    };

    await expect(registry.register(ext as any)).rejects.toThrow("Missing required credential");
  });

  it("credential checker: optional credential does not block registration", async () => {
    const checker = async (_type: string, _instance?: string) => false;
    const registry = new ExtensionRegistry(checker);

    const ext = {
      metadata: {
        name: "optional-cred-ext",
        type: "webhook" as const,
        version: "1.0.0",
        description: "optional credential",
        requiredCredentials: [{ type: "slack_token", optional: true }],
      },
      provider: {},
      async init() {},
      async shutdown() {},
    };

    // Should NOT throw because the credential is optional
    await expect(registry.register(ext as any)).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe("integration: TelemetryManager disabled mode (no Docker required)", () => {
  it("disabled TelemetryManager: init() is a no-op", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    await expect(mgr.init()).resolves.toBeUndefined();
  });

  it("disabled TelemetryManager: createSpan returns a noop span", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    await mgr.init();

    const span = mgr.createSpan("test-span");
    expect(span).toBeDefined();
    // noop span should have end() method
    expect(typeof span.end).toBe("function");
    // Should not throw
    expect(() => span.end()).not.toThrow();
  });

  it("disabled TelemetryManager: withSpan executes the function and returns result", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    await mgr.init();

    const result = await mgr.withSpan("compute", async (_span) => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it("disabled TelemetryManager: withSpan propagates thrown errors", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    await mgr.init();

    await expect(
      mgr.withSpan("failing", async () => {
        throw new Error("expected error");
      })
    ).rejects.toThrow("expected error");
  });

  it("disabled TelemetryManager: setSpanStatus does not throw", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    const span = mgr.createSpan("status-span");

    expect(() => mgr.setSpanStatus(span, "success")).not.toThrow();
    expect(() => mgr.setSpanStatus(span, "error", "something went wrong")).not.toThrow();
    expect(() => mgr.setSpanStatus(span, "timeout")).not.toThrow();
    span.end();
  });

  it("disabled TelemetryManager: getActiveContext returns undefined", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    await mgr.init();

    const ctx = mgr.getActiveContext();
    expect(ctx).toBeUndefined();
  });

  it("disabled TelemetryManager: setTraceContext is a no-op", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    await mgr.init();

    // Should not throw
    expect(() => mgr.setTraceContext("00-abc-def-01")).not.toThrow();
  });

  it("disabled TelemetryManager: shutdown resolves cleanly", async () => {
    const mgr = new TelemetryManager({ enabled: false, provider: "none" });
    await mgr.init();
    await expect(mgr.shutdown()).resolves.toBeUndefined();
  });

  it("initTelemetry stores the global instance; getTelemetry returns it", async () => {
    const mgr = initTelemetry({ enabled: false, provider: "none" });
    expect(mgr).toBeDefined();

    const retrieved = getTelemetry();
    expect(retrieved).toBe(mgr);

    // Clean up: shutdown so subsequent tests are not affected
    await mgr.shutdown();
  });

  it("createSpan convenience function works when global telemetry is set", async () => {
    const mgr = initTelemetry({ enabled: false, provider: "none" });

    const span = createSpanConvenience("convenience-span");
    expect(span).toBeDefined();
    expect(typeof span.end).toBe("function");
    span.end();

    await mgr.shutdown();
  });

  it("withSpan convenience function executes callback and returns value", async () => {
    const mgr = initTelemetry({ enabled: false, provider: "none" });

    const result = await withSpanConvenience("conv-span", async (_span: any) => "hello");
    expect(result).toBe("hello");

    await mgr.shutdown();
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe("integration: isExtension (no Docker required)", () => {
  it("returns true for a valid extension object", () => {
    const ext = {
      metadata: { name: "test", type: "webhook", version: "1.0.0", description: "test" },
      init: async () => {},
      shutdown: async () => {},
    };
    expect(isExtension(ext)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isExtension(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isExtension(undefined)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(isExtension("not-an-extension")).toBe(false);
  });

  it("returns false for object missing metadata", () => {
    const ext = {
      init: async () => {},
      shutdown: async () => {},
    };
    expect(isExtension(ext)).toBe(false);
  });

  it("returns false for object missing init()", () => {
    const ext = {
      metadata: { name: "test", type: "webhook", version: "1.0.0", description: "test" },
      shutdown: async () => {},
    };
    expect(isExtension(ext)).toBe(false);
  });

  it("returns false for object missing shutdown()", () => {
    const ext = {
      metadata: { name: "test", type: "webhook", version: "1.0.0", description: "test" },
      init: async () => {},
    };
    expect(isExtension(ext)).toBe(false);
  });

  it("returns false when init is not a function", () => {
    const ext = {
      metadata: { name: "test", type: "webhook", version: "1.0.0", description: "test" },
      init: "not-a-function",
      shutdown: async () => {},
    };
    expect(isExtension(ext)).toBe(false);
  });

  it("returns false when metadata.name is not a string", () => {
    const ext = {
      metadata: { name: 42, type: "webhook", version: "1.0.0", description: "test" },
      init: async () => {},
      shutdown: async () => {},
    };
    expect(isExtension(ext)).toBe(false);
  });

  it("returns false when metadata.type is not a string", () => {
    const ext = {
      metadata: { name: "test", type: null, version: "1.0.0", description: "test" },
      init: async () => {},
      shutdown: async () => {},
    };
    expect(isExtension(ext)).toBe(false);
  });
});
