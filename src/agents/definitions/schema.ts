// --- Agent definition package schema ---

import type { CredentialDefinition } from "../../credentials/schema.js";

export interface ParamDefinition {
  type: "string" | "string[]";
  description: string;
  default?: string;
  required: boolean;
  credential?: string;
}

export interface AgentDefinition {
  name: string;
  label?: string;
  description?: string;
  credentials: {
    required: string[];
    optional: string[];
  };
  params: Record<string, ParamDefinition>;
  credentialDefinitions?: Record<string, CredentialDefinition>;
}

// --- Validation ---

export function validateDefinition(json: unknown): AgentDefinition {
  if (!json || typeof json !== "object") {
    throw new Error("Definition must be a non-null object");
  }

  const obj = json as Record<string, unknown>;

  requireString(obj, "name");
  optionalString(obj, "label");
  optionalString(obj, "description");

  // credentials
  if (!obj.credentials || typeof obj.credentials !== "object") {
    throw new Error("Definition must have a 'credentials' object");
  }
  const creds = obj.credentials as Record<string, unknown>;
  requireStringArray(creds, "required");
  requireStringArray(creds, "optional");

  // params
  if (!obj.params || typeof obj.params !== "object") {
    throw new Error("Definition must have a 'params' object");
  }
  const params = obj.params as Record<string, unknown>;
  for (const [key, val] of Object.entries(params)) {
    validateParamDefinition(key, val);
  }

  // credentialDefinitions (optional, code objects — no deep validation needed)
  if (obj.credentialDefinitions !== undefined) {
    if (typeof obj.credentialDefinitions !== "object" || obj.credentialDefinitions === null) {
      throw new Error("'credentialDefinitions' must be an object if present");
    }
  }

  return json as AgentDefinition;
}

function validateParamDefinition(key: string, val: unknown): void {
  if (!val || typeof val !== "object") {
    throw new Error(`Param "${key}" must be an object`);
  }
  const p = val as Record<string, unknown>;

  if (p.type !== "string" && p.type !== "string[]") {
    throw new Error(`Param "${key}" type must be "string" or "string[]"`);
  }
  requireString(p, "description", `param "${key}"`);
  if (typeof p.required !== "boolean") {
    throw new Error(`Param "${key}" must have a boolean 'required' field`);
  }
  if (p.default !== undefined && typeof p.default !== "string") {
    throw new Error(`Param "${key}" default must be a string`);
  }
  if (p.credential !== undefined && typeof p.credential !== "string") {
    throw new Error(`Param "${key}" credential must be a string`);
  }
}

function optionalString(obj: Record<string, unknown>, field: string): void {
  if (obj[field] !== undefined && (typeof obj[field] !== "string" || (obj[field] as string).length === 0)) {
    throw new Error(`'${field}' must be a non-empty string if present`);
  }
}

function requireString(obj: Record<string, unknown>, field: string, context?: string): void {
  const prefix = context ? `${context}: ` : "";
  if (typeof obj[field] !== "string" || (obj[field] as string).length === 0) {
    throw new Error(`${prefix}'${field}' must be a non-empty string`);
  }
}

function requireStringArray(obj: Record<string, unknown>, field: string): void {
  if (!Array.isArray(obj[field]) || !obj[field].every((v: unknown) => typeof v === "string")) {
    throw new Error(`'${field}' must be an array of strings`);
  }
}
