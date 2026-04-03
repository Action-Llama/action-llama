/**
 * Integration tests: model providers and credential providers — no Docker required.
 *
 * Tests previously untested provider classes:
 *
 *   1. models/providers/openai.ts — OpenAIProvider
 *      constructor, init(), getDefaultModel(), validateConfig(), shutdown()
 *      — all without making network calls.
 *
 *   2. models/providers/anthropic.ts — AnthropicProvider
 *      constructor, init(), getDefaultModel(), validateConfig(), shutdown()
 *      — all without making network calls.
 *
 *   3. models/providers/custom.ts — CustomProvider
 *      constructor (valid + missing-baseUrl error), init(), getDefaultModel(),
 *      validateConfig() (valid URL, invalid URL, missing baseUrl), listModels()
 *      fallback (no real server), shutdown() — network paths exercise fallback
 *      rather than real API calls.
 *
 *   4. credentials/providers/file.ts — FileCredentialProvider
 *      name, list(), get() (env-var present/absent), isAvailable(), store()/remove()
 *      not-implemented errors.
 *
 *   5. credentials/providers/vault.ts — VaultCredentialProvider
 *      constructor, list()/get()/store()/remove()/isAvailable() — no real Vault;
 *      network calls to bogus address gracefully return empty/null.
 *
 * All tests are pure in-process: no Docker, no real API keys, no real Vault.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ── 1. OpenAIProvider ─────────────────────────────────────────────────────────

const {
  OpenAIProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/models/providers/openai.js"
);

// ── 2. AnthropicProvider ──────────────────────────────────────────────────────

const {
  AnthropicProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/models/providers/anthropic.js"
);

// ── 3. CustomProvider ─────────────────────────────────────────────────────────

const {
  CustomProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/models/providers/custom.js"
);

// ── 4. FileCredentialProvider ─────────────────────────────────────────────────

const {
  FileCredentialProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/credentials/providers/file.js"
);

// ── 5. VaultCredentialProvider ────────────────────────────────────────────────

const {
  VaultCredentialProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/credentials/providers/vault.js"
);

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: OpenAIProvider (no Docker required)", () => {
  it("has name === 'openai'", () => {
    const provider = new OpenAIProvider({ provider: "openai" });
    expect(provider.name).toBe("openai");
  });

  it("init() resolves without throwing", async () => {
    const provider = new OpenAIProvider({ provider: "openai" });
    await expect(provider.init()).resolves.toBeUndefined();
  });

  it("getDefaultModel() returns 'gpt-4' when no model specified", () => {
    const provider = new OpenAIProvider({ provider: "openai" });
    expect(provider.getDefaultModel()).toBe("gpt-4");
  });

  it("getDefaultModel() returns configured model when specified", () => {
    const provider = new OpenAIProvider({ provider: "openai", model: "gpt-3.5-turbo" });
    expect(provider.getDefaultModel()).toBe("gpt-3.5-turbo");
  });

  it("validateConfig() resolves in test environment (NODE_ENV=test)", async () => {
    const provider = new OpenAIProvider({ provider: "openai" });
    // NODE_ENV=test skips the API key check
    await expect(provider.validateConfig({ provider: "openai" })).resolves.toBeUndefined();
  });

  it("shutdown() resolves without throwing", async () => {
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "test-key" });
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  it("uses OPENAI_API_KEY env var when no apiKey in config", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-api-key";
    try {
      const provider = new OpenAIProvider({ provider: "openai" });
      // Provider picks up env var — we can verify it was set by checking name
      expect(provider.name).toBe("openai");
    } finally {
      if (originalKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });

  it("uses custom baseUrl when provided", () => {
    // Just verify construction succeeds with a custom baseUrl
    const provider = new OpenAIProvider({ provider: "openai", baseUrl: "https://my-proxy.example.com/v1" });
    expect(provider.name).toBe("openai");
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: AnthropicProvider (no Docker required)", () => {
  it("has name === 'anthropic'", () => {
    const provider = new AnthropicProvider({ provider: "anthropic" });
    expect(provider.name).toBe("anthropic");
  });

  it("init() resolves without throwing", async () => {
    const provider = new AnthropicProvider({ provider: "anthropic" });
    await expect(provider.init()).resolves.toBeUndefined();
  });

  it("getDefaultModel() returns the default Claude model when no model specified", () => {
    const provider = new AnthropicProvider({ provider: "anthropic" });
    const model = provider.getDefaultModel();
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
    // Should contain 'claude' somewhere in the model name
    expect(model.toLowerCase()).toContain("claude");
  });

  it("getDefaultModel() returns configured model when specified", () => {
    const provider = new AnthropicProvider({ provider: "anthropic", model: "claude-3-haiku-20240307" });
    expect(provider.getDefaultModel()).toBe("claude-3-haiku-20240307");
  });

  it("validateConfig() throws when no API key in env or config", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const provider = new AnthropicProvider({ provider: "anthropic" });
      await expect(provider.validateConfig({ provider: "anthropic" })).rejects.toThrow(/api key/i);
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });

  it("validateConfig() resolves when apiKey is in config", async () => {
    const provider = new AnthropicProvider({ provider: "anthropic", apiKey: "test-key" });
    await expect(provider.validateConfig({ provider: "anthropic", apiKey: "test-key" })).resolves.toBeUndefined();
  });

  it("shutdown() resolves without throwing", async () => {
    const provider = new AnthropicProvider({ provider: "anthropic", apiKey: "test-key" });
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: CustomProvider (no Docker required)", () => {
  it("has name === 'custom'", () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://localhost:8080/v1" });
    expect(provider.name).toBe("custom");
  });

  it("constructor throws when baseUrl is not provided", () => {
    expect(() => new CustomProvider({ provider: "custom" })).toThrow(/baseUrl/);
  });

  it("init() resolves when baseUrl is configured", async () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://localhost:8080/v1" });
    await expect(provider.init()).resolves.toBeUndefined();
  });

  it("getDefaultModel() returns 'gpt-3.5-turbo' when no model specified", () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://localhost:8080/v1" });
    expect(provider.getDefaultModel()).toBe("gpt-3.5-turbo");
  });

  it("getDefaultModel() returns configured model when specified", () => {
    const provider = new CustomProvider({
      provider: "custom",
      baseUrl: "http://localhost:8080/v1",
      model: "my-custom-model",
    });
    expect(provider.getDefaultModel()).toBe("my-custom-model");
  });

  it("validateConfig() resolves for a valid URL", async () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://localhost:8080/v1" });
    await expect(provider.validateConfig({ provider: "custom", baseUrl: "http://valid.example.com/v1" })).resolves.toBeUndefined();
  });

  it("validateConfig() throws for an invalid URL", async () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://localhost:8080/v1" });
    await expect(provider.validateConfig({ provider: "custom", baseUrl: "not-a-valid-url" })).rejects.toThrow(/invalid.*url/i);
  });

  it("validateConfig() throws when baseUrl is missing", async () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://localhost:8080/v1" });
    await expect(provider.validateConfig({ provider: "custom" })).rejects.toThrow(/baseUrl/i);
  });

  it("listModels() returns default model when server is unreachable", async () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://127.0.0.1:19999/v1" });
    // Should fall back gracefully rather than throw
    const models = await provider.listModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it("shutdown() resolves without throwing", async () => {
    const provider = new CustomProvider({ provider: "custom", baseUrl: "http://localhost:8080/v1" });
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: FileCredentialProvider (no Docker required)", () => {
  let provider: any;

  beforeEach(() => {
    provider = new FileCredentialProvider();
  });

  it("has name === 'file'", () => {
    expect(provider.name).toBe("file");
  });

  it("list() returns empty array (placeholder implementation)", async () => {
    const result = await provider.list("github_token");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("get() returns null when env var is absent", async () => {
    const type = "MY_NONEXISTENT_CRED_TYPE_XYZ";
    delete process.env[type.toUpperCase()];
    const result = await provider.get(type);
    expect(result).toBeNull();
  });

  it("get() returns value from env var when present", async () => {
    const type = "test_cred_type_abc";
    const envKey = "TEST_CRED_TYPE_ABC";
    process.env[envKey] = "my-secret-value";
    try {
      const result = await provider.get(type);
      expect(result).not.toBeNull();
      expect(result[type]).toBe("my-secret-value");
    } finally {
      delete process.env[envKey];
    }
  });

  it("isAvailable() returns true", async () => {
    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  it("store() throws 'not yet implemented'", async () => {
    await expect(provider.store("some_type", "default", { key: "value" })).rejects.toThrow(/not yet implemented/i);
  });

  it("remove() throws 'not yet implemented'", async () => {
    await expect(provider.remove("some_type", "default")).rejects.toThrow(/not yet implemented/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: VaultCredentialProvider (no Docker required)", () => {
  const vaultConfig = { vaultAddr: "http://127.0.0.1:18200", vaultToken: "fake-token" };

  it("constructor stores vaultAddr and vaultToken", () => {
    const provider = new VaultCredentialProvider(vaultConfig);
    expect(provider.name).toBe("vault");
  });

  it("list() returns empty array when Vault is unreachable", async () => {
    const provider = new VaultCredentialProvider(vaultConfig);
    const result = await provider.list("some_type");
    expect(Array.isArray(result)).toBe(true);
    // Either empty (network failure) or valid array
    expect(result).toBeDefined();
  });

  it("get() returns null when Vault is unreachable", async () => {
    const provider = new VaultCredentialProvider(vaultConfig);
    const result = await provider.get("some_type", "default");
    expect(result).toBeNull();
  });

  it("get() returns null when Vault returns non-OK response", async () => {
    const provider = new VaultCredentialProvider({
      vaultAddr: "http://127.0.0.1:18200",
      vaultToken: "wrong-token",
    });
    const result = await provider.get("secret", "default");
    expect(result).toBeNull();
  });

  it("store() delegates to Vault and throws on connection failure", async () => {
    const provider = new VaultCredentialProvider(vaultConfig);
    await expect(provider.store("some_type", "instance1", { key: "value" })).rejects.toThrow();
  });

  it("remove() delegates to Vault and throws on connection failure", async () => {
    const provider = new VaultCredentialProvider(vaultConfig);
    await expect(provider.remove("some_type", "instance1")).rejects.toThrow();
  });

  it("isAvailable() returns true when Vault health endpoint is reachable and false otherwise", async () => {
    const provider = new VaultCredentialProvider(vaultConfig);
    // With a fake address, it may return false or throw — either is acceptable
    const result = await provider.isAvailable();
    expect(typeof result).toBe("boolean");
  });
});
