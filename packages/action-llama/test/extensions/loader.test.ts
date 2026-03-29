import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadBuiltinExtensions, isExtension, getGlobalRegistry } from "../../src/extensions/loader.js";
import { globalRegistry } from "../../src/extensions/registry.js";

// Mock the imports to avoid loading actual extensions during tests
vi.mock("../../src/webhooks/providers/index.js", () => ({
  githubWebhookExtension: {
    metadata: { name: "github", type: "webhook", version: "1.0.0", description: "GitHub provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  linearWebhookExtension: {
    metadata: { name: "linear", type: "webhook", version: "1.0.0", description: "Linear provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  mintlifyWebhookExtension: {
    metadata: { name: "mintlify", type: "webhook", version: "1.0.0", description: "Mintlify provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  sentryWebhookExtension: {
    metadata: { name: "sentry", type: "webhook", version: "1.0.0", description: "Sentry provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  testWebhookExtension: {
    metadata: { name: "test", type: "webhook", version: "1.0.0", description: "Test provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../../src/telemetry/providers/otel.js", () => ({
  otelExtension: {
    metadata: { name: "otel", type: "telemetry", version: "1.0.0", description: "OTel provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../../src/docker/providers/index.js", () => ({
  localDockerExtension: {
    metadata: { name: "local", type: "runtime", version: "1.0.0", description: "Local Docker" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  sshDockerExtension: {
    metadata: { name: "ssh", type: "runtime", version: "1.0.0", description: "SSH Docker" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../../src/models/providers/index.js", () => ({
  openAIModelExtension: {
    metadata: { name: "openai", type: "model", version: "1.0.0", description: "OpenAI provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  anthropicModelExtension: {
    metadata: { name: "anthropic", type: "model", version: "1.0.0", description: "Anthropic provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  customModelExtension: {
    metadata: { name: "custom", type: "model", version: "1.0.0", description: "Custom provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../../src/credentials/providers/index.js", () => ({
  fileCredentialExtension: {
    metadata: { name: "file", type: "credential", version: "1.0.0", description: "File provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  },
  vaultCredentialExtension: {
    metadata: { name: "vault", type: "credential", version: "1.0.0", description: "Vault provider" },
    provider: {},
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("Extension Loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the global registry before each test
    Object.assign(globalRegistry, new (globalRegistry.constructor as any)());
  });

  describe("isExtension", () => {
    it("should identify valid extensions", () => {
      const validExtension = {
        metadata: {
          name: "test",
          type: "webhook",
          version: "1.0.0",
          description: "Test extension"
        },
        init: async () => {},
        shutdown: async () => {}
      };

      expect(isExtension(validExtension)).toBe(true);
    });

    it("should reject invalid objects", () => {
      expect(isExtension(null)).toBe(false);
      expect(isExtension(undefined)).toBe(false);
      expect(isExtension({})).toBe(false);
      expect(isExtension({ metadata: {} })).toBe(false);
      expect(isExtension({ 
        metadata: { name: "test" },
        init: "not a function"
      })).toBe(false);
    });
  });

  describe("loadBuiltinExtensions", () => {
    it("should load built-in extensions without credential checker", async () => {
      await expect(loadBuiltinExtensions()).resolves.not.toThrow();
    });

    it("should load extensions with credential checker", async () => {
      const credentialChecker = vi.fn().mockResolvedValue(true);

      await expect(loadBuiltinExtensions(credentialChecker)).resolves.not.toThrow();
    });

    it("should handle loading errors gracefully", async () => {
      const originalWarn = console.warn;
      const mockWarn = vi.fn();
      console.warn = mockWarn;

      // Mock a failed import by throwing during module resolution
      vi.doMock("../../src/webhooks/providers/index.js", () => {
        throw new Error("Failed to load webhook extensions");
      });

      try {
        await expect(loadBuiltinExtensions()).resolves.not.toThrow();
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should only load model extensions for specified providers", async () => {
      const { openAIModelExtension, anthropicModelExtension, customModelExtension } =
        await import("../../src/models/providers/index.js");

      // Only request "anthropic" provider
      await loadBuiltinExtensions(undefined, new Set(["anthropic"]));

      expect(anthropicModelExtension.init).toHaveBeenCalled();
      expect(openAIModelExtension.init).not.toHaveBeenCalled();
      expect(customModelExtension.init).not.toHaveBeenCalled();
    });

    it("should load all model extensions when no providers specified", async () => {
      const { openAIModelExtension, anthropicModelExtension, customModelExtension } =
        await import("../../src/models/providers/index.js");

      await loadBuiltinExtensions();

      expect(openAIModelExtension.init).toHaveBeenCalled();
      expect(anthropicModelExtension.init).toHaveBeenCalled();
      expect(customModelExtension.init).toHaveBeenCalled();
    });

    it("should register vault extension when VAULT_ADDR is set", async () => {
      const { vaultCredentialExtension } = await import("../../src/credentials/providers/index.js");

      const originalVaultAddr = process.env.VAULT_ADDR;
      process.env.VAULT_ADDR = "http://localhost:8200";
      try {
        await loadBuiltinExtensions();
        expect(vaultCredentialExtension.init).toHaveBeenCalled();
      } finally {
        if (originalVaultAddr === undefined) {
          delete process.env.VAULT_ADDR;
        } else {
          process.env.VAULT_ADDR = originalVaultAddr;
        }
      }
    });
  });

  describe("getGlobalRegistry", () => {
    it("returns the global registry instance", () => {
      const registry = getGlobalRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe("function");
      expect(typeof registry.get).toBe("function");
    });

    it("returns the same reference as globalRegistry", () => {
      const registry = getGlobalRegistry();
      expect(registry).toBe(globalRegistry);
    });
  });
});