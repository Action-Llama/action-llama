import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadBuiltinExtensions, isExtension } from "../../src/extensions/loader.js";
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
    // Clear the global registry before each test
    Object.assign(globalRegistry, new (globalRegistry.constructor as any)());
    
    // Mock console.log for tests that expect it
    vi.spyOn(console, "log").mockImplementation(() => {});
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
      await loadBuiltinExtensions();

      // Verify that extensions were loaded (this is a basic test since we're mocking the imports)
      expect(console.log).toHaveBeenCalledWith("Built-in extensions loaded successfully");
    });

    it("should load extensions with credential checker", async () => {
      const credentialChecker = vi.fn().mockResolvedValue(true);
      
      await loadBuiltinExtensions(credentialChecker);

      expect(console.log).toHaveBeenCalledWith("Built-in extensions loaded successfully");
    });

    it("should handle loading errors gracefully", async () => {
      // Mock console.warn to capture warning messages
      const originalWarn = console.warn;
      console.warn = vi.fn();

      // Mock a failed import by throwing during module resolution
      vi.doMock("../../src/webhooks/providers/index.js", () => {
        throw new Error("Failed to load webhook extensions");
      });

      try {
        await loadBuiltinExtensions();
        // Should still succeed but log warnings
        expect(console.log).toHaveBeenCalledWith("Built-in extensions loaded successfully");
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});