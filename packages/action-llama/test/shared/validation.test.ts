import { describe, expect, it } from "vitest";
import {
  validateCronExpression,
  validateConfigSchema,
  detectUnknownFields,
  detectGlobalConfigUnknownFields,
  detectAgentFrontmatterUnknownFields,
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

  describe("detectGlobalConfigUnknownFields", () => {
    it("accepts named model sub-keys", () => {
      const raw = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
          opus: { provider: "anthropic", model: "claude-opus-4-20250514" },
        },
        scale: 3,
      };

      const unknownFields = detectGlobalConfigUnknownFields(raw);
      expect(unknownFields).toEqual([]);
    });

    it("flags unknown fields inside named model configs", () => {
      const raw = {
        models: {
          sonnet: { provider: "anthropic", bogus: true },
        },
      };

      const unknownFields = detectGlobalConfigUnknownFields(raw);
      expect(unknownFields).toEqual(["models.sonnet.bogus"]);
    });

    it("accepts agents and historyRetentionDays", () => {
      const raw = {
        agents: { dev: { scale: 2 } },
        historyRetentionDays: 30,
      };

      const unknownFields = detectGlobalConfigUnknownFields(raw);
      expect(unknownFields).toEqual([]);
    });
  });

  describe("detectAgentFrontmatterUnknownFields", () => {
    it("accepts valid frontmatter structure", () => {
      const raw = {
        description: "A test agent",
        metadata: {
          credentials: ["anthropic_key"],
          models: ["sonnet"],
          schedule: "0 * * * *",
          webhooks: [],
          params: { foo: "bar" },
        },
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toEqual([]);
    });

    it("flags unknown top-level frontmatter fields", () => {
      const raw = {
        description: "test",
        bogusField: true,
        metadata: { credentials: [], models: ["sonnet"] },
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toEqual(["bogusField"]);
    });

    it("flags unknown metadata fields", () => {
      const raw = {
        metadata: {
          credentials: [],
          models: ["sonnet"],
          bogus: true,
        },
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toEqual(["metadata.bogus"]);
    });

    it("flags scale and timeout in metadata as unknown", () => {
      const raw = {
        metadata: {
          credentials: [],
          models: ["sonnet"],
          scale: 2,
          timeout: 300,
        },
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toContain("metadata.scale");
      expect(unknownFields).toContain("metadata.timeout");
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

    it("passes config with any model/provider (validated by the provider API at runtime)", () => {
      const config: GlobalConfig = {
        models: {
          "custom": {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            authType: "api_key",
          },
        },
      };

      const result = validateGlobalConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
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

    it("passes any model name (validated by the provider API at runtime)", () => {
      const config: AgentConfig = {
        name: "test-agent",
        credentials: [],
        models: [
          {
            provider: "openai",
            model: "gpt-4o-2025-03-01",
            authType: "api_key",
          },
        ],
      };

      const result = validateAgentConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
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