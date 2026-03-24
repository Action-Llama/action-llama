/**
 * Enhanced validation functions for Action Llama configurations.
 * Provides schema validation, unknown field detection, cron validation,
 * model/provider compatibility checks, and unsafe config warnings.
 */

import { Cron } from "croner";
import type { AgentConfig, GlobalConfig, ModelConfig } from "./config.js";

export interface ValidationError {
  type: "error" | "warning";
  message: string;
  field?: string;
  context?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ConfigSchema {
  required: Set<string>;
  optional: Set<string>;
  nested: Record<string, ConfigSchema>;
}

// --- Schema definitions ---

// Schema for individual model config (used inside named model sub-keys)
const MODEL_CONFIG_SCHEMA: ConfigSchema = {
  required: new Set(),
  optional: new Set(["provider", "model", "thinkingLevel", "authType"]),
  nested: {}
};

const GLOBAL_CONFIG_SCHEMA: ConfigSchema = {
  required: new Set(),
  optional: new Set([
    "models", "local", "gateway", "webhooks", "telemetry",
    "projectName", "maxReruns", "maxCallDepth", "maxTriggerDepth",
    "webhookQueueSize", "workQueueSize", "resourceLockTimeout", "scale",
    "agents", "historyRetentionDays"
  ]),
  nested: {
    local: {
      required: new Set(),
      optional: new Set(["enabled", "image", "memory", "cpus", "timeout"]),
      nested: {}
    },
    gateway: {
      required: new Set(),
      optional: new Set(["port", "url"]),
      nested: {}
    },
    telemetry: {
      required: new Set(),
      optional: new Set(["enabled", "provider", "endpoint", "serviceName", "headers", "samplingRate"]),
      nested: {}
    },
  }
};

const AGENT_CONFIG_SCHEMA: ConfigSchema = {
  required: new Set(["name", "credentials", "models"]),
  optional: new Set([
    "description", "schedule", "webhooks", "hooks", "params",
    "license", "compatibility"
  ]),
  nested: {
    hooks: {
      required: new Set(),
      optional: new Set(["pre", "post"]),
      nested: {}
    },
  }
};

/**
 * Schema for raw SKILL.md YAML frontmatter (before resolution).
 * `name` is derived from the directory name, and AL-specific fields
 * like `credentials` and `models` live under `metadata`.
 */
const AGENT_FRONTMATTER_SCHEMA: ConfigSchema = {
  required: new Set(),
  optional: new Set(["description", "license", "compatibility", "metadata"]),
  nested: {
    metadata: {
      required: new Set(["credentials", "models"]),
      optional: new Set(["schedule", "webhooks", "hooks", "params"]),
      nested: {
        hooks: {
          required: new Set(),
          optional: new Set(["pre", "post"]),
          nested: {}
        },
      }
    },
  }
};

/**
 * Validate a cron expression using the croner library.
 */
export function validateCronExpression(schedule: string): { valid: boolean; error?: string } {
  try {
    // Test by creating a Cron instance - if invalid, it will throw
    const job = new Cron(schedule, { paused: true });
    job.stop(); // Clean up immediately
    return { valid: true };
  } catch (err) {
    return { 
      valid: false, 
      error: err instanceof Error ? err.message : String(err)
    };
  }
}


/**
 * Validate config against a schema and return validation errors.
 */
export function validateConfigSchema(
  config: unknown,
  schema: ConfigSchema,
  path = ""
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (typeof config !== "object" || config === null) {
    errors.push({
      type: "error",
      message: "Configuration must be an object",
      field: path
    });
    return { valid: false, errors, warnings };
  }

  const configObj = config as Record<string, unknown>;

  // Check required fields
  for (const field of schema.required) {
    if (!(field in configObj)) {
      errors.push({
        type: "error",
        message: `Required field "${field}" is missing`,
        field: path ? `${path}.${field}` : field
      });
    }
  }

  // Validate nested objects
  for (const [field, nestedSchema] of Object.entries(schema.nested)) {
    if (field in configObj && configObj[field] != null) {
      const nestedPath = path ? `${path}.${field}` : field;
      if (typeof configObj[field] === "object") {
        const nestedResult = validateConfigSchema(configObj[field], nestedSchema, nestedPath);
        errors.push(...nestedResult.errors);
        warnings.push(...nestedResult.warnings);
      }
    }
  }

  return { 
    valid: errors.length === 0, 
    errors, 
    warnings 
  };
}

/**
 * Detect unknown fields in config that are not in the schema.
 */
export function detectUnknownFields(
  config: unknown,
  schema: ConfigSchema,
  path = ""
): string[] {
  const unknownFields: string[] = [];

  if (typeof config !== "object" || config === null) {
    return unknownFields;
  }

  const configObj = config as Record<string, unknown>;
  const allowedFields = new Set([...schema.required, ...schema.optional, ...Object.keys(schema.nested)]);

  for (const field of Object.keys(configObj)) {
    const fieldPath = path ? `${path}.${field}` : field;
    
    if (!allowedFields.has(field)) {
      unknownFields.push(fieldPath);
    } else if (field in schema.nested && configObj[field] != null) {
      // Recursively check nested objects
      if (typeof configObj[field] === "object") {
        unknownFields.push(...detectUnknownFields(configObj[field], schema.nested[field], fieldPath));
      }
    }
  }

  return unknownFields;
}

/**
 * Validate global config with comprehensive checks.
 */
export function validateGlobalConfig(config: GlobalConfig, raw?: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Schema validation
  if (raw) {
    const schemaResult = validateConfigSchema(raw, GLOBAL_CONFIG_SCHEMA);
    errors.push(...schemaResult.errors);
    warnings.push(...schemaResult.warnings);
  }

  // Unsafe config warnings
  if (config.gateway?.url?.includes("0.0.0.0")) {
    warnings.push({
      type: "warning",
      message: "Gateway is bound to 0.0.0.0 (public interface). Consider using localhost for security.",
      field: "gateway.url",
      context: "unsafe configuration"
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate agent config with comprehensive checks.
 */
export function validateAgentConfig(config: AgentConfig, raw?: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Schema validation — raw is SKILL.md frontmatter (metadata-nested), not the resolved config
  if (raw) {
    const schemaResult = validateConfigSchema(raw, AGENT_FRONTMATTER_SCHEMA);
    errors.push(...schemaResult.errors);
    warnings.push(...schemaResult.warnings);
  }

  // Cron validation
  if (config.schedule) {
    const cronResult = validateCronExpression(config.schedule);
    if (!cronResult.valid) {
      errors.push({
        type: "error",
        message: `Invalid cron expression "${config.schedule}": ${cronResult.error}`,
        field: "schedule",
        context: "cron validation"
      });
    }
  }

  // pi_auth warning (already blocked at startup, but surface it in doctor too)
  if (config.models) {
    for (const [index, modelConfig] of config.models.entries()) {
      if (modelConfig.authType === "pi_auth") {
        warnings.push({
          type: "warning",
          message: `Model ${index} uses pi_auth which is not supported in container mode`,
          field: `models[${index}].authType`,
          context: "unsafe configuration"
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Check for unknown fields in global config.
 * `models` uses named sub-keys (e.g. `models.sonnet`), so we validate
 * each sub-object against the model config schema individually.
 */
export function detectGlobalConfigUnknownFields(raw: unknown): string[] {
  const fields = detectUnknownFields(raw, GLOBAL_CONFIG_SCHEMA);

  // Validate named model sub-keys
  if (typeof raw === "object" && raw !== null) {
    const models = (raw as Record<string, unknown>).models;
    if (typeof models === "object" && models !== null) {
      for (const [name, value] of Object.entries(models as Record<string, unknown>)) {
        if (typeof value === "object" && value !== null) {
          fields.push(...detectUnknownFields(value, MODEL_CONFIG_SCHEMA, `models.${name}`));
        }
      }
    }
  }

  return fields;
}

/**
 * Check for unknown fields in agent SKILL.md frontmatter.
 * Validates the raw frontmatter structure (top-level + metadata).
 */
export function detectAgentFrontmatterUnknownFields(raw: unknown): string[] {
  return detectUnknownFields(raw, AGENT_FRONTMATTER_SCHEMA);
}