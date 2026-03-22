import { describe, expect, it } from "vitest";
import {
  validateCronExpression,
  validateModelProviderCompat,
  validateConfigSchema,
  detectUnknownFields,
  validateGlobalConfig,
  validateAgentConfig,
  type ConfigSchema,
} from "../../src/shared/validation.js";
import type { GlobalConfig, AgentConfig } from "../../src/shared/config.js";

describe("validation", () => {
  describe("validateCronExpression", () => {
    it("accepts valid cron expressions", () => {
      const validCrons = [
        "0 * * * *",        // Every hour
        "*/15 * * * *",     // Every 15 minutes
        "@daily",           // Daily shorthand
        "@hourly",          // Hourly shorthand
        "0 0 * * 0",        // Every Sunday midnight
        "30 2 * * 1-5",     // Weekdays at 2:30 AM
      ];

      for (const cron of validCrons) {
        const result = validateCronExpression(cron);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it("rejects invalid cron expressions", () => {
      const invalidCrons = [
        "invalid",          // Not a cron
        "* * * *",          // Too few fields
        "60 * * * *",       // Invalid minute (> 59)
        "* 25 * * *",       // Invalid hour (> 23)
        "",                 // Empty string
      ];

      for (const cron of invalidCrons) {
        const result = validateCronExpression(cron);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("validateModelProviderCompat", () => {
    it("accepts valid model/provider combinations", () => {
      const validCombos = [
        { provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" },
        { provider: "openai", model: "gpt-4o", authType: "api_key" },
        { provider: "deepseek", model: "deepseek-chat", authType: "api_key" },
        { provider: "google", model: "gemini-pro", authType: "api_key" },
        { provider: "openrouter", model: "anthropic/claude-3-sonnet", authType: "api_key" },
      ];

      for (const combo of validCombos) {
        const result = validateModelProviderCompat(combo.provider, combo.model, combo.authType);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it("rejects unknown providers", () => {
      const result = validateModelProviderCompat("unknown-provider", "some-model", "api_key");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown provider");
    });

    it("rejects incompatible model/provider combinations", () => {
      const result = validateModelProviderCompat("anthropic", "gpt-4", "api_key");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not supported by provider");
    });

    it("rejects unsupported auth types", () => {
      // Assuming anthropic only supports api_key
      const result = validateModelProviderCompat("anthropic", "claude-3-sonnet", "oauth_token");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not supported by provider");
    });
  });

  describe("detectUnknownFields", () => {
    const testSchema: ConfigSchema = {
      required: new Set(["name"]),
      optional: new Set(["description", "enabled"]),
      nested: {
        models: {
          required: new Set(["provider"]),
          optional: new Set(["model"]),
          nested: {},
        },
      },
    };

    it("detects unknown top-level fields", () => {
      const config = {
        name: "test",
        unknownField: "value",
      };

      const unknownFields = detectUnknownFields(config, testSchema);
      expect(unknownFields).toContain("unknownField");
    });

    it("detects unknown nested fields", () => {
      const config = {
        name: "test",
        models: {
          provider: "test",
          unknownNested: "value",
        },
      };

      const unknownFields = detectUnknownFields(config, testSchema);
      expect(unknownFields).toContain("models.unknownNested");
    });

    it("returns empty array for valid config", () => {
      const config = {
        name: "test",
        description: "test desc",
        models: {
          provider: "test",
          model: "test-model",
        },
      };

      const unknownFields = detectUnknownFields(config, testSchema);
      expect(unknownFields).toEqual([]);
    });
  });

  describe("validateGlobalConfig", () => {
    it("passes valid global config", () => {
      const config: GlobalConfig = {
        models: {
          "claude": {
            provider: "anthropic",
            model: "claude-3-sonnet",
            authType: "api_key",
          },
        },
        scale: 5,
      };

      const result = validateGlobalConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("warns about unsafe gateway binding", () => {
      const config: GlobalConfig = {
        gateway: {
          url: "http://0.0.0.0:8080",
        },
      };

      const result = validateGlobalConfig(config);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("0.0.0.0");
      expect(result.warnings[0].context).toBe("unsafe configuration");
    });

    it("fails for invalid model configurations", () => {
      const config: GlobalConfig = {
        models: {
          "invalid": {
            provider: "nonexistent",
            model: "some-model",
            authType: "api_key",
          },
        },
      };

      const result = validateGlobalConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Unknown provider");
    });
  });

  describe("validateAgentConfig", () => {
    it("passes valid agent config", () => {
      const config: AgentConfig = {
        name: "test-agent",
        credentials: [],
        models: [
          {
            provider: "anthropic",
            model: "claude-3-sonnet",
            authType: "api_key",
          },
        ],
        schedule: "0 * * * *",
      };

      const result = validateAgentConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails for invalid cron schedule", () => {
      const config: AgentConfig = {
        name: "test-agent",
        credentials: [],
        models: [
          {
            provider: "anthropic",
            model: "claude-3-sonnet",
            authType: "api_key",
          },
        ],
        schedule: "invalid-cron",
      };

      const result = validateAgentConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Invalid cron expression");
    });

    it("warns about pi_auth usage", () => {
      const config: AgentConfig = {
        name: "test-agent",
        credentials: [],
        models: [
          {
            provider: "anthropic",
            model: "claude-3-sonnet",
            authType: "pi_auth",
          },
        ],
      };

      const result = validateAgentConfig(config);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("pi_auth");
      expect(result.warnings[0].context).toBe("unsafe configuration");
    });

    it("fails for invalid model configurations", () => {
      const config: AgentConfig = {
        name: "test-agent",
        credentials: [],
        models: [
          {
            provider: "openai",
            model: "claude-3-sonnet", // Wrong model for OpenAI
            authType: "api_key",
          },
        ],
      };

      const result = validateAgentConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("not supported by provider");
    });
  });

  describe("validateConfigSchema", () => {
    const testSchema: ConfigSchema = {
      required: new Set(["name", "type"]),
      optional: new Set(["description"]),
      nested: {},
    };

    it("passes valid config", () => {
      const config = {
        name: "test",
        type: "example",
        description: "optional field",
      };

      const result = validateConfigSchema(config, testSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails for missing required fields", () => {
      const config = {
        name: "test",
        // missing required 'type' field
      };

      const result = validateConfigSchema(config, testSchema);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Required field "type" is missing');
    });

    it("fails for non-object config", () => {
      const result = validateConfigSchema("not an object", testSchema);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Configuration must be an object");
    });
  });
});