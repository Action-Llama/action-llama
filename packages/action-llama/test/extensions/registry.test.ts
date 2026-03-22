import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExtensionRegistry } from "../../src/extensions/registry.js";
import type { Extension, TelemetryExtension, WebhookExtension } from "../../src/extensions/types.js";

describe("ExtensionRegistry", () => {
  let registry: ExtensionRegistry;
  let mockCredentialChecker: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCredentialChecker = vi.fn();
    registry = new ExtensionRegistry(mockCredentialChecker);
  });

  describe("registration", () => {
    it("should register a valid extension", async () => {
      const mockExtension: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(mockExtension);

      expect(mockExtension.init).toHaveBeenCalled();
      expect(registry.get("webhook", "test")).toBe(mockExtension);
    });

    it("should prevent duplicate registrations", async () => {
      const extension1: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension 1",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      const extension2: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension 2",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(extension1);
      
      await expect(registry.register(extension2)).rejects.toThrow(
        "Extension webhook/test already registered"
      );
    });

    it("should validate required credentials", async () => {
      mockCredentialChecker.mockResolvedValue(false);

      const extensionWithCredentials: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension",
          type: "telemetry",
          requiredCredentials: [
            { type: "api_key", description: "API key" }
          ]
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await expect(registry.register(extensionWithCredentials)).rejects.toThrow(
        "Missing required credential: api_key"
      );
    });

    it("should allow optional credentials to be missing", async () => {
      mockCredentialChecker.mockResolvedValue(false);

      const extensionWithOptionalCredentials: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension",
          type: "telemetry",
          requiredCredentials: [
            { type: "api_key", description: "API key", optional: true }
          ]
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await expect(registry.register(extensionWithOptionalCredentials)).resolves.not.toThrow();
    });

    it("should register credential types provided by extensions", async () => {
      const extensionWithCredentialTypes: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension",
          type: "credential",
          providesCredentialTypes: [
            {
              type: "custom_api_key",
              fields: ["key"],
              description: "Custom API key"
            }
          ]
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(extensionWithCredentialTypes);

      const credentialType = registry.getCredentialType("custom_api_key");
      expect(credentialType).toBeDefined();
      expect(credentialType?.description).toBe("Custom API key");
    });
  });

  describe("retrieval", () => {
    it("should retrieve extensions by type and name", async () => {
      const mockExtension: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(mockExtension);

      expect(registry.get("webhook", "test")).toBe(mockExtension);
      expect(registry.get("webhook", "nonexistent")).toBeUndefined();
    });

    it("should retrieve all extensions by type", async () => {
      const extension1: Extension = {
        metadata: {
          name: "test1",
          version: "1.0.0",
          description: "Test extension 1",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      const extension2: Extension = {
        metadata: {
          name: "test2",
          version: "1.0.0",
          description: "Test extension 2",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(extension1);
      await registry.register(extension2);

      const webhookExtensions = registry.getAllWebhookExtensions();
      expect(webhookExtensions).toHaveLength(2);
      expect(webhookExtensions.map(e => e.metadata.name)).toContain("test1");
      expect(webhookExtensions.map(e => e.metadata.name)).toContain("test2");
    });
  });

  describe("unregistration", () => {
    it("should unregister extensions and call shutdown", async () => {
      const mockExtension: Extension = {
        metadata: {
          name: "test",
          version: "1.0.0",
          description: "Test extension",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(mockExtension);
      await registry.unregister("webhook", "test");

      expect(mockExtension.shutdown).toHaveBeenCalled();
      expect(registry.get("webhook", "test")).toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("should shutdown all registered extensions", async () => {
      const extension1: Extension = {
        metadata: {
          name: "test1",
          version: "1.0.0",
          description: "Test extension 1",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      const extension2: Extension = {
        metadata: {
          name: "test2",
          version: "1.0.0",
          description: "Test extension 2",
          type: "telemetry"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(extension1);
      await registry.register(extension2);

      await registry.shutdown();

      expect(extension1.shutdown).toHaveBeenCalled();
      expect(extension2.shutdown).toHaveBeenCalled();
    });
  });

  describe("listing", () => {
    it("should list all registered extensions", async () => {
      const extension1: Extension = {
        metadata: {
          name: "test1",
          version: "1.0.0",
          description: "Test extension 1",
          type: "webhook"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      const extension2: Extension = {
        metadata: {
          name: "test2",
          version: "2.0.0",
          description: "Test extension 2",
          type: "telemetry"
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      await registry.register(extension1);
      await registry.register(extension2);

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({
        type: "webhook",
        name: "test1",
        version: "1.0.0",
        description: "Test extension 1"
      });
      expect(list).toContainEqual({
        type: "telemetry",
        name: "test2",
        version: "2.0.0",
        description: "Test extension 2"
      });
    });
  });
});