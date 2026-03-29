import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExtensionRegistry } from "../../src/extensions/registry.js";
import type {
  Extension,
  TelemetryExtension,
  WebhookExtension,
  RuntimeExtension,
  ModelExtension,
  CredentialExtension,
} from "../../src/extensions/types.js";

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

  describe("type-specific getters", () => {
    function makeExtension(type: "webhook" | "telemetry" | "runtime" | "model" | "credential", name: string): Extension {
      return {
        metadata: { name, type, version: "1.0.0", description: `${type}/${name}` },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("getTelemetryExtension returns registered telemetry extension", async () => {
      const ext = makeExtension("telemetry", "otel");
      await registry.register(ext);
      const found = registry.getTelemetryExtension("otel");
      expect(found).toBe(ext);
      expect(registry.getTelemetryExtension("nonexistent")).toBeUndefined();
    });

    it("getRuntimeExtension returns registered runtime extension", async () => {
      const ext = makeExtension("runtime", "local");
      await registry.register(ext);
      const found = registry.getRuntimeExtension("local");
      expect(found).toBe(ext);
      expect(registry.getRuntimeExtension("nonexistent")).toBeUndefined();
    });

    it("getModelExtension returns registered model extension", async () => {
      const ext = makeExtension("model", "openai");
      await registry.register(ext);
      const found = registry.getModelExtension("openai");
      expect(found).toBe(ext);
      expect(registry.getModelExtension("nonexistent")).toBeUndefined();
    });

    it("getCredentialExtension returns registered credential extension", async () => {
      const ext = makeExtension("credential", "file");
      await registry.register(ext);
      const found = registry.getCredentialExtension("file");
      expect(found).toBe(ext);
      expect(registry.getCredentialExtension("nonexistent")).toBeUndefined();
    });

    it("getAllTelemetryExtensions returns all telemetry extensions", async () => {
      await registry.register(makeExtension("telemetry", "otel"));
      const all = registry.getAllTelemetryExtensions();
      expect(all).toHaveLength(1);
      expect(all[0].metadata.name).toBe("otel");
    });

    it("getAllRuntimeExtensions returns all runtime extensions", async () => {
      await registry.register(makeExtension("runtime", "local"));
      await registry.register(makeExtension("runtime", "ssh"));
      const all = registry.getAllRuntimeExtensions();
      expect(all).toHaveLength(2);
      expect(all.map(e => e.metadata.name)).toContain("local");
      expect(all.map(e => e.metadata.name)).toContain("ssh");
    });

    it("getAllModelExtensions returns all model extensions", async () => {
      await registry.register(makeExtension("model", "anthropic"));
      const all = registry.getAllModelExtensions();
      expect(all).toHaveLength(1);
      expect(all[0].metadata.name).toBe("anthropic");
    });

    it("getAllCredentialExtensions returns all credential extensions", async () => {
      await registry.register(makeExtension("credential", "file"));
      const all = registry.getAllCredentialExtensions();
      expect(all).toHaveLength(1);
      expect(all[0].metadata.name).toBe("file");
    });

    it("getAllCredentialTypes returns all registered credential types", async () => {
      const ext: Extension = {
        metadata: {
          name: "typed-cred",
          type: "credential",
          version: "1.0.0",
          description: "extension with credential types",
          providesCredentialTypes: [
            { type: "my_api_key", fields: ["key"], description: "My API key" },
            { type: "my_token", fields: ["token"], description: "My token" },
          ],
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
      await registry.register(ext);

      const all = registry.getAllCredentialTypes();
      expect(all).toHaveLength(2);
      expect(all.map(t => t.type)).toContain("my_api_key");
      expect(all.map(t => t.type)).toContain("my_token");
    });
  });

  describe("registration edge cases", () => {
    it("throws when registering with an invalid extension type", async () => {
      // Force invalid type by casting — this simulates an unknown type
      const ext = {
        metadata: { name: "bad", type: "unknown-type" as any, version: "1.0.0", description: "bad" },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
      await expect(registry.register(ext)).rejects.toThrow("Invalid extension type: unknown-type");
    });

    it("unregister with invalid type returns without error", async () => {
      // Should not throw for unknown type
      await expect(
        registry.unregister("webhook" as any, "nonexistent")
      ).resolves.not.toThrow();
    });

    it("required credential with instance name includes instance in error message", async () => {
      mockCredentialChecker.mockResolvedValue(false);
      const ext: Extension = {
        metadata: {
          name: "inst-ext",
          type: "webhook",
          version: "1.0.0",
          description: "test",
          requiredCredentials: [{ type: "github_token", instance: "myorg", description: "GitHub token" }],
        },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
      await expect(registry.register(ext)).rejects.toThrow("Missing required credential: github_token:myorg");
    });
  });

  describe("shutdown error handling", () => {
    it("logs warning but does not throw when a shutdown fails", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ext: Extension = {
        metadata: { name: "failing-ext", type: "webhook", version: "1.0.0", description: "test" },
        init: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockRejectedValue(new Error("shutdown failure")),
      };
      await registry.register(ext);
      await expect(registry.shutdown()).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("failing-ext"),
        expect.any(Error)
      );
      warnSpy.mockRestore();
    });
  });
});