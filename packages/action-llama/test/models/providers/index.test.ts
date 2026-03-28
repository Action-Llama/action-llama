import { describe, it, expect } from "vitest";
import {
  openAIModelExtension,
  anthropicModelExtension,
  customModelExtension,
} from "../../../src/models/providers/index.js";

describe("openAIModelExtension", () => {
  describe("metadata", () => {
    it("has name 'openai'", () => {
      expect(openAIModelExtension.metadata.name).toBe("openai");
    });

    it("has version '1.0.0'", () => {
      expect(openAIModelExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'model'", () => {
      expect(openAIModelExtension.metadata.type).toBe("model");
    });

    it("requires openai_api_key credential", () => {
      const types = openAIModelExtension.metadata.requiredCredentials!.map((c) => c.type);
      expect(types).toContain("openai_api_key");
    });

    it("has a non-empty description", () => {
      expect(typeof openAIModelExtension.metadata.description).toBe("string");
      expect(openAIModelExtension.metadata.description.length).toBeGreaterThan(0);
    });

    it("provides openai_api_key credential type with api_key field", () => {
      const provided = openAIModelExtension.metadata.providesCredentialTypes!;
      const openaiKey = provided.find((t) => t.type === "openai_api_key")!;
      expect(openaiKey).toBeDefined();
      expect(openaiKey.fields).toContain("api_key");
    });
  });

  describe("provider", () => {
    it("provider name is 'openai'", () => {
      expect(openAIModelExtension.provider.name).toBe("openai");
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      await expect(openAIModelExtension.init()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(openAIModelExtension.shutdown()).resolves.toBeUndefined();
    });
  });
});

describe("anthropicModelExtension", () => {
  describe("metadata", () => {
    it("has name 'anthropic'", () => {
      expect(anthropicModelExtension.metadata.name).toBe("anthropic");
    });

    it("has version '1.0.0'", () => {
      expect(anthropicModelExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'model'", () => {
      expect(anthropicModelExtension.metadata.type).toBe("model");
    });

    it("requires anthropic_api_key credential", () => {
      const types = anthropicModelExtension.metadata.requiredCredentials!.map((c) => c.type);
      expect(types).toContain("anthropic_api_key");
    });

    it("has a non-empty description", () => {
      expect(typeof anthropicModelExtension.metadata.description).toBe("string");
      expect(anthropicModelExtension.metadata.description.length).toBeGreaterThan(0);
    });

    it("provides anthropic_api_key credential type with api_key field", () => {
      const provided = anthropicModelExtension.metadata.providesCredentialTypes!;
      const anthropicKey = provided.find((t) => t.type === "anthropic_api_key")!;
      expect(anthropicKey).toBeDefined();
      expect(anthropicKey.fields).toContain("api_key");
    });
  });

  describe("provider", () => {
    it("provider name is 'anthropic'", () => {
      expect(anthropicModelExtension.provider.name).toBe("anthropic");
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      await expect(anthropicModelExtension.init()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(anthropicModelExtension.shutdown()).resolves.toBeUndefined();
    });
  });
});

describe("customModelExtension", () => {
  describe("metadata", () => {
    it("has name 'custom'", () => {
      expect(customModelExtension.metadata.name).toBe("custom");
    });

    it("has version '1.0.0'", () => {
      expect(customModelExtension.metadata.version).toBe("1.0.0");
    });

    it("has type 'model'", () => {
      expect(customModelExtension.metadata.type).toBe("model");
    });

    it("has a non-empty description", () => {
      expect(typeof customModelExtension.metadata.description).toBe("string");
      expect(customModelExtension.metadata.description.length).toBeGreaterThan(0);
    });

    it("custom_api_key credential is optional", () => {
      const customApiKey = customModelExtension.metadata.requiredCredentials!.find(
        (c) => c.type === "custom_api_key"
      )!;
      expect(customApiKey).toBeDefined();
      expect(customApiKey.optional).toBe(true);
    });

    it("requires custom_base_url credential", () => {
      const types = customModelExtension.metadata.requiredCredentials!.map((c) => c.type);
      expect(types).toContain("custom_base_url");
    });
  });

  describe("provider", () => {
    it("provider name is 'custom'", () => {
      expect(customModelExtension.provider.name).toBe("custom");
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      await expect(customModelExtension.init()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(customModelExtension.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("providesCredentialTypes", () => {
    const providesTypes = customModelExtension.metadata.providesCredentialTypes!;

    describe("custom_base_url", () => {
      const baseUrlType = providesTypes.find((t) => t.type === "custom_base_url")!;

      it("has fields [base_url]", () => {
        expect(baseUrlType.fields).toEqual(["base_url"]);
      });

      it("has a description", () => {
        expect(typeof baseUrlType.description).toBe("string");
        expect(baseUrlType.description.length).toBeGreaterThan(0);
      });

      it("validation resolves for a valid URL", async () => {
        await expect(
          baseUrlType.validation!({ base_url: "http://localhost:8080/v1" })
        ).resolves.toBeUndefined();
      });

      it("validation throws for an invalid URL", async () => {
        await expect(
          baseUrlType.validation!({ base_url: "not-a-url" })
        ).rejects.toThrow();
      });
    });

    describe("custom_api_key", () => {
      const apiKeyType = providesTypes.find((t) => t.type === "custom_api_key")!;

      it("has fields [api_key]", () => {
        expect(apiKeyType.fields).toContain("api_key");
      });

      it("has envMapping for api_key to CUSTOM_API_KEY", () => {
        expect(apiKeyType.envMapping).toEqual({ api_key: "CUSTOM_API_KEY" });
      });
    });
  });
});
