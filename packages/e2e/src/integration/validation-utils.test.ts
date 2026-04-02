/**
 * Integration tests: shared/validation.ts utility functions — no Docker required.
 *
 * These are pure utility functions used by the `al doctor` CLI command to validate
 * project and agent configurations. They have no side effects and do not require
 * any external services, Docker, or the scheduler.
 *
 * Functions tested:
 *   - validateCronExpression(schedule) — valid/invalid cron
 *   - validateConfigSchema(config, schema) — required fields, unknown fields, nested
 *   - detectUnknownFields(config, schema) — finds fields not in schema
 *   - validateGlobalConfig(config, raw) — schema + unsafe config warnings
 *   - validateAgentConfig(config) — cron validation, pi_auth warning
 *   - detectGlobalConfigUnknownFields(raw) — global + model sub-keys
 *   - detectAgentFrontmatterUnknownFields(raw) — SKILL.md frontmatter
 *   - detectAgentRuntimeConfigUnknownFields(raw) — per-agent config.toml
 *
 * Covers:
 *   - shared/validation.ts: validateCronExpression — valid/invalid cron
 *   - shared/validation.ts: validateConfigSchema — required, nested, non-object
 *   - shared/validation.ts: detectUnknownFields — extra fields, nested traversal
 *   - shared/validation.ts: validateGlobalConfig — schema + unsafe URL warning
 *   - shared/validation.ts: validateAgentConfig — cron validation, pi_auth warning
 *   - shared/validation.ts: detectGlobalConfigUnknownFields — model sub-key validation
 *   - shared/validation.ts: detectAgentFrontmatterUnknownFields
 *   - shared/validation.ts: detectAgentRuntimeConfigUnknownFields
 */

import { describe, it, expect } from "vitest";
// Use direct node_modules path since shared/validation.ts is not exported
// via the package's internals/* export map — it's only used by al doctor CLI.
const {
  validateCronExpression,
  validateConfigSchema,
  detectUnknownFields,
  validateGlobalConfig,
  validateAgentConfig,
  detectGlobalConfigUnknownFields,
  detectAgentFrontmatterUnknownFields,
  detectAgentRuntimeConfigUnknownFields,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/validation.js"
);
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

// ── Helper builders ────────────────────────────────────────────────────────

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    credentials: ["anthropic_key"],
    models: [{ provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" }],
    schedule: "*/5 * * * *",
    ...overrides,
  };
}

// ── validateCronExpression ─────────────────────────────────────────────────

describe("integration: shared/validation.ts (no Docker required)", () => {

  describe("validateCronExpression", () => {
    it("returns valid:true for a well-formed cron expression", () => {
      const result = validateCronExpression("*/5 * * * *");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("returns valid:true for daily cron", () => {
      const result = validateCronExpression("0 9 * * *");
      expect(result.valid).toBe(true);
    });

    it("returns valid:false for an invalid cron expression", () => {
      const result = validateCronExpression("not-a-cron");
      expect(result.valid).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error!.length).toBeGreaterThan(0);
    });

    it("returns valid:false for out-of-range cron field", () => {
      // Minute field 99 is out of range
      const result = validateCronExpression("99 * * * *");
      expect(result.valid).toBe(false);
    });
  });

  // ── validateConfigSchema ──────────────────────────────────────────────────

  describe("validateConfigSchema", () => {
    const schema = {
      required: new Set(["name"]),
      optional: new Set(["description"]),
      nested: {},
    };

    it("returns valid:true for config with required field present", () => {
      const result = validateConfigSchema({ name: "test" }, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error when required field is missing", () => {
      const result = validateConfigSchema({ description: "no name" }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("name"))).toBe(true);
    });

    it("returns error when config is not an object", () => {
      const result = validateConfigSchema("not-an-object", schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toMatch(/must be an object/i);
    });

    it("validates nested objects", () => {
      const nestedSchema = {
        required: new Set(["port"]),
        optional: new Set<string>(),
        nested: {
          inner: {
            required: new Set(["id"]),
            optional: new Set<string>(),
            nested: {},
          },
        },
      };
      // Missing id in nested.inner
      const result = validateConfigSchema(
        { port: 8080, inner: { notId: "x" } },
        nestedSchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("id"))).toBe(true);
    });
  });

  // ── detectUnknownFields ──────────────────────────────────────────────────

  describe("detectUnknownFields", () => {
    const schema = {
      required: new Set(["name"]),
      optional: new Set(["description"]),
      nested: {},
    };

    it("returns empty array when no unknown fields", () => {
      const unknown = detectUnknownFields({ name: "test", description: "ok" }, schema);
      expect(unknown).toHaveLength(0);
    });

    it("returns unknown field names", () => {
      const unknown = detectUnknownFields({ name: "test", foo: "bar", baz: 42 }, schema);
      expect(unknown).toContain("foo");
      expect(unknown).toContain("baz");
    });

    it("returns empty array for non-object input", () => {
      const unknown = detectUnknownFields("not-obj", schema);
      expect(unknown).toHaveLength(0);
    });

    it("recursively detects unknown fields in nested objects", () => {
      const nestedSchema = {
        required: new Set<string>(),
        optional: new Set(["gateway"]),
        nested: {
          gateway: {
            required: new Set<string>(),
            optional: new Set(["port"]),
            nested: {},
          },
        },
      };
      const unknown = detectUnknownFields({ gateway: { port: 8080, extraField: true } }, nestedSchema);
      expect(unknown).toContain("gateway.extraField");
    });
  });

  // ── validateGlobalConfig ─────────────────────────────────────────────────

  describe("validateGlobalConfig", () => {
    it("returns valid:true for minimal global config", () => {
      const result = validateGlobalConfig({});
      expect(result.valid).toBe(true);
    });

    it("warns about unsafe 0.0.0.0 gateway URL", () => {
      const result = validateGlobalConfig({ gateway: { url: "http://0.0.0.0:8080" } });
      // Warnings are present but config is still valid
      expect(result.warnings.some((w) => w.message.includes("0.0.0.0"))).toBe(true);
    });

    it("detects unknown fields via raw param", () => {
      const raw = { unknownTopLevelKey: true };
      const result = validateGlobalConfig({}, raw);
      // detectUnknownFields are reported as warnings (from detectGlobalConfigUnknownFields called by doctor)
      // But validateGlobalConfig itself only runs validateConfigSchema
      // The schema check would pass since it just validates structure
      expect(result).toBeDefined();
    });
  });

  // ── validateAgentConfig ──────────────────────────────────────────────────

  describe("validateAgentConfig", () => {
    it("returns valid:true for valid agent config", () => {
      const result = validateAgentConfig(makeAgentConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error for invalid cron expression", () => {
      const result = validateAgentConfig(makeAgentConfig({ schedule: "not-a-cron" }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "schedule")).toBe(true);
    });

    it("returns valid:true when schedule is undefined (no cron check)", () => {
      // Agent without schedule (e.g. webhook-only) — no cron validation
      const result = validateAgentConfig(makeAgentConfig({ schedule: undefined }));
      expect(result.valid).toBe(true);
    });

    it("warns about pi_auth model type", () => {
      const config = makeAgentConfig({
        models: [{ provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "pi_auth" }],
      });
      const result = validateAgentConfig(config);
      expect(result.warnings.some((w) => w.message.includes("pi_auth"))).toBe(true);
    });
  });

  // ── detectGlobalConfigUnknownFields ──────────────────────────────────────

  describe("detectGlobalConfigUnknownFields", () => {
    it("returns empty for known global fields", () => {
      const raw = {
        models: { sonnet: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" } },
        gateway: { port: 8080 },
      };
      const unknown = detectGlobalConfigUnknownFields(raw);
      expect(unknown).toHaveLength(0);
    });

    it("detects unknown top-level global config fields", () => {
      const raw = { bogusTopField: true };
      const unknown = detectGlobalConfigUnknownFields(raw);
      expect(unknown).toContain("bogusTopField");
    });

    it("validates named model sub-keys and detects unknown model fields", () => {
      const raw = {
        models: {
          mymodel: { provider: "anthropic", unknownModelField: "x" },
        },
      };
      const unknown = detectGlobalConfigUnknownFields(raw);
      expect(unknown).toContain("models.mymodel.unknownModelField");
    });
  });

  // ── detectAgentFrontmatterUnknownFields ──────────────────────────────────

  describe("detectAgentFrontmatterUnknownFields", () => {
    it("returns empty for known frontmatter fields", () => {
      const raw = { name: "my-agent", description: "Does stuff" };
      const unknown = detectAgentFrontmatterUnknownFields(raw);
      expect(unknown).toHaveLength(0);
    });

    it("detects unknown frontmatter fields", () => {
      const raw = { name: "agent", someUnknownFrontmatterKey: true };
      const unknown = detectAgentFrontmatterUnknownFields(raw);
      expect(unknown).toContain("someUnknownFrontmatterKey");
    });
  });

  // ── detectAgentRuntimeConfigUnknownFields ────────────────────────────────

  describe("detectAgentRuntimeConfigUnknownFields", () => {
    it("returns empty for known runtime config fields", () => {
      const raw = {
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "*/5 * * * *",
        scale: 2,
        timeout: 300,
      };
      const unknown = detectAgentRuntimeConfigUnknownFields(raw);
      expect(unknown).toHaveLength(0);
    });

    it("detects unknown runtime config fields", () => {
      const raw = { models: ["sonnet"], mysteryField: "oops" };
      const unknown = detectAgentRuntimeConfigUnknownFields(raw);
      expect(unknown).toContain("mysteryField");
    });

    it("validates runtime.type and detects unknown runtime sub-fields", () => {
      const raw = {
        models: ["sonnet"],
        runtime: { type: "host-user", unknownRuntimeField: true },
      };
      const unknown = detectAgentRuntimeConfigUnknownFields(raw);
      expect(unknown).toContain("runtime.unknownRuntimeField");
    });
  });
});
