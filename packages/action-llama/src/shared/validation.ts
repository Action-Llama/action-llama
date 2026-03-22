/**
 * Enhanced validation functions for Action Llama configurations.
 * Provides schema validation, unknown field detection, cron validation,
 * model/provider compatibility checks, and unsafe config warnings.
 */

import { Cron } from "croner";
import type { AgentConfig, GlobalConfig, ModelConfig } from "./config.js";
import { PROVIDER_MODELS } from "./constants.js";

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

const GLOBAL_CONFIG_SCHEMA: ConfigSchema = {
  required: new Set(),
  optional: new Set([
    "models", "local", "gateway", "webhooks", "telemetry", "feedback",
    "projectName", "maxReruns", "maxCallDepth", "maxTriggerDepth",
    "webhookQueueSize", "workQueueSize", "resourceLockTimeout", "scale"
  ]),
  nested: {
    models: {
      required: new Set(),
      optional: new Set(["provider", "model", "thinkingLevel", "authType"]),
      nested: {}
    },
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
    feedback: {
      required: new Set(),
      optional: new Set(["enabled", "agent", "errorPatterns", "contextLines"]),
      nested: {}
    }
  }
};

const AGENT_CONFIG_SCHEMA: ConfigSchema = {
  required: new Set(["name", "credentials", "models"]),
  optional: new Set([
    "description", "schedule", "webhooks", "hooks", "params", "scale",
    "timeout", "feedback", "license", "compatibility"
  ]),
  nested: {
    hooks: {
      required: new Set(),
      optional: new Set(["pre", "post"]),
      nested: {}
    },
    feedback: {
      required: new Set(),
      optional: new Set(["enabled"]),
      nested: {}
    }
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
 * Validate model/provider/authType compatibility.
 */
export function validateModelProviderCompat(
  provider: string,
  model: string,
  authType: string
): { valid: boolean; error?: string } {
  const providerConfig = PROVIDER_MODELS[provider];
  if (!providerConfig) {
    const knownProviders = Object.keys(PROVIDER_MODELS).join(", ");
    return {
      valid: false,
      error: `Unknown provider "${provider}". Known providers: ${knownProviders}`
    };
  }

  // Check if model matches any of the provider's model patterns
  const modelMatches = providerConfig.models.some(pattern => {
    if (pattern.endsWith("*")) {
      return model.startsWith(pattern.slice(0, -1));
    }
    return model === pattern;
  });

  if (!modelMatches) {
    const supportedModels = providerConfig.models.join(", ");
    return {
      valid: false,
      error: `Model "${model}" is not supported by provider "${provider}". Supported models: ${supportedModels}`
    };
  }

  // Check if authType is supported
  if (!providerConfig.authTypes.includes(authType)) {
    const supportedAuth = providerConfig.authTypes.join(", ");
    return {
      valid: false,
      error: `Auth type "${authType}" is not supported by provider "${provider}". Supported auth types: ${supportedAuth}`
    };
  }

  return { valid: true };
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

  // Model validation
  if (config.models) {
    for (const [name, modelConfig] of Object.entries(config.models)) {
      const compatResult = validateModelProviderCompat(
        modelConfig.provider,
        modelConfig.model,
        modelConfig.authType
      );
      if (!compatResult.valid) {
        errors.push({
          type: "error",
          message: `Model "${name}": ${compatResult.error}`,
          field: `models.${name}`,
          context: "model compatibility"
        });
      }
    }
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

  // Schema validation
  if (raw) {
    const schemaResult = validateConfigSchema(raw, AGENT_CONFIG_SCHEMA);
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

  // Model validation (models should already be resolved to ModelConfig objects)
  if (config.models) {
    for (const [index, modelConfig] of config.models.entries()) {
      const compatResult = validateModelProviderCompat(
        modelConfig.provider,
        modelConfig.model,
        modelConfig.authType
      );
      if (!compatResult.valid) {
        errors.push({
          type: "error",
          message: `Model ${index}: ${compatResult.error}`,
          field: `models[${index}]`,
          context: "model compatibility"
        });
      }

      // pi_auth warning (already checked elsewhere, but included for completeness)
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
 */
export function detectGlobalConfigUnknownFields(raw: unknown): string[] {
  return detectUnknownFields(raw, GLOBAL_CONFIG_SCHEMA);
}

/**
 * Check for unknown fields in agent config.
 */
export function detectAgentConfigUnknownFields(raw: unknown): string[] {
  return detectUnknownFields(raw, AGENT_CONFIG_SCHEMA);
}