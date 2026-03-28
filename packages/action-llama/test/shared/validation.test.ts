import { describe, expect, it } from "vitest";
import {
  validateCronExpression,
  validateConfigSchema,
  detectUnknownFields,
  detectGlobalConfigUnknownFields,
  detectAgentFrontmatterUnknownFields,
  detectAgentRuntimeConfigUnknownFields,
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

    it("flags agents as unknown in global config", () => {
      const raw = {
        agents: { dev: { scale: 2 } },
        historyRetentionDays: 30,
      };

      const unknownFields = detectGlobalConfigUnknownFields(raw);
      expect(unknownFields).toContain("agents");
    });
  });

  describe("detectAgentFrontmatterUnknownFields", () => {
    it("accepts valid frontmatter structure", () => {
      const raw = {
        name: "test-agent",
        description: "A test agent",
        license: "MIT",
        compatibility: ">=0.5.0",
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toEqual([]);
    });

    it("flags unknown top-level frontmatter fields", () => {
      const raw = {
        description: "test",
        bogusField: true,
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toEqual(["bogusField"]);
    });

    it("flags runtime config fields as unknown in frontmatter", () => {
      const raw = {
        description: "test",
        credentials: ["anthropic_key"],
        models: ["sonnet"],
        schedule: "0 * * * *",
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toContain("credentials");
      expect(unknownFields).toContain("models");
      expect(unknownFields).toContain("schedule");
    });

    it("flags metadata as unknown in frontmatter", () => {
      const raw = {
        description: "test",
        metadata: {
          credentials: [],
          models: ["sonnet"],
        },
      };

      const unknownFields = detectAgentFrontmatterUnknownFields(raw);
      expect(unknownFields).toContain("metadata");
    });
  });

  describe("detectAgentRuntimeConfigUnknownFields", () => {
    it("accepts valid runtime config fields", () => {
      const raw = {
        source: "github",
        credentials: ["anthropic_key"],
        models: ["sonnet"],
        schedule: "0 * * * *",
        webhooks: [],
        hooks: { pre: ["echo hello"], post: ["echo done"] },
        params: { foo: "bar" },
        scale: 2,
        timeout: 300,
      };

      const unknownFields = detectAgentRuntimeConfigUnknownFields(raw);
      expect(unknownFields).toEqual([]);
    });

    it("accepts a subset of runtime config fields", () => {
      const raw = {
        credentials: ["anthropic_key"],
        models: ["sonnet"],
        schedule: "0 * * * *",
      };

      const unknownFields = detectAgentRuntimeConfigUnknownFields(raw);
      expect(unknownFields).toEqual([]);
    });

    it("flags unknown fields in runtime config", () => {
      const raw = {
        credentials: ["anthropic_key"],
        models: ["sonnet"],
        bogusField: true,
        anotherBogus: "value",
      };

      const unknownFields = detectAgentRuntimeConfigUnknownFields(raw);
      expect(unknownFields).toContain("bogusField");
      expect(unknownFields).toContain("anotherBogus");
    });

    it("returns empty array for empty config", () => {
      const raw = {};

      const unknownFields = detectAgentRuntimeConfigUnknownFields(raw);
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

      const result = validateAgentConfig(config, undefined, undefined);
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

      const result = validateAgentConfig(config, undefined, undefined);
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

      const result = validateAgentConfig(config, undefined, undefined);
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

      const result = validateAgentConfig(config, undefined, undefined);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("validates with raw frontmatter and runtime config", () => {
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

      const rawFrontmatter = {
        name: "test-agent",
        description: "A test agent",
      };

      const rawRuntimeConfig = {
        credentials: ["anthropic_key"],
        models: ["sonnet"],
        schedule: "0 * * * *",
      };

      const result = validateAgentConfig(config, rawFrontmatter, rawRuntimeConfig);
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

    it("uses path prefix in nested field paths when path is provided", () => {
      const nestedSchema: ConfigSchema = {
        required: new Set(["host"]),
        optional: new Set(["port"]),
        nested: {
          sub: {
            required: new Set(["key"]),
            optional: new Set(),
            nested: {}
          }
        }
      };

      const config = { sub: { badField: "oops" } };
      const result = validateConfigSchema(config, nestedSchema, "parent");

      // The nested path should be "parent.sub.key" for the missing required field
      const keyError = result.errors.find((e) => e.field?.includes("sub.key"));
      expect(keyError).toBeDefined();
      expect(keyError!.field).toBe("parent.sub.key");
    });

    it("validates nested objects recursively and propagates errors", () => {
      const nestedSchema: ConfigSchema = {
        required: new Set(),
        optional: new Set(["name"]),
        nested: {
          database: {
            required: new Set(["host"]),
            optional: new Set(["port"]),
            nested: {}
          }
        }
      };

      const config = { database: { port: 5432 } }; // missing required "host"
      const result = validateConfigSchema(config, nestedSchema);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('"host" is missing'))).toBe(true);
    });
  });

  describe("detectUnknownFields — edge cases", () => {
    const simpleSchema: ConfigSchema = {
      required: new Set(["name"]),
      optional: new Set(["description"]),
      nested: {}
    };

    it("returns empty array for null input", () => {
      const result = detectUnknownFields(null, simpleSchema);
      expect(result).toEqual([]);
    });

    it("returns empty array for non-object input", () => {
      const result = detectUnknownFields("string input", simpleSchema);
      expect(result).toEqual([]);
    });
  });

  describe("validateGlobalConfig — with raw config", () => {
    it("validates raw global config schema and propagates errors", () => {
      const config: GlobalConfig = {};
      const raw = { unknownField: "value" };

      // Unknown fields don't produce schema errors (only detectUnknownFields does that)
      // Schema errors come from required fields being missing
      const result = validateGlobalConfig(config, raw);
      // Global config has no required fields, so it should be valid
      expect(result.valid).toBe(true);
    });

    it("propagates schema validation results when raw is provided", () => {
      const config: GlobalConfig = {
        gateway: { url: "http://0.0.0.0:8080" },
      };
      const raw = { gateway: { url: "http://0.0.0.0:8080" } };

      const result = validateGlobalConfig(config, raw);
      // Should produce the 0.0.0.0 warning
      expect(result.warnings.some((w) => w.message.includes("0.0.0.0"))).toBe(true);
    });
  });
});
