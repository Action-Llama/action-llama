// --- Agent definition package schema ---

export interface WebhookFilterMapping {
  field: string;
  wrap?: "array";
}

export interface ParamDefinition {
  type: "string" | "string[]";
  description: string;
  default?: string;
  required: boolean;
  webhookFilter?: WebhookFilterMapping;
  credential?: string;
}

export interface AgentDefinition {
  name: string;
  label: string;
  description: string;
  credentials: {
    required: string[];
    optional: string[];
  };
  webhooks: {
    description: string;
    events: string[];
    actions: string[];
  };
  prompts: {
    webhook: string;
    schedule: string;
  };
  defaultSchedule: string;
  state?: {
    file: string;
    initial: Record<string, unknown>;
  };
  params: Record<string, ParamDefinition>;
}

// --- Validation ---

export function validateDefinition(json: unknown): AgentDefinition {
  if (!json || typeof json !== "object") {
    throw new Error("Definition must be a non-null object");
  }

  const obj = json as Record<string, unknown>;

  requireString(obj, "name");
  requireString(obj, "label");
  requireString(obj, "description");

  // credentials
  if (!obj.credentials || typeof obj.credentials !== "object") {
    throw new Error("Definition must have a 'credentials' object");
  }
  const creds = obj.credentials as Record<string, unknown>;
  requireStringArray(creds, "required");
  requireStringArray(creds, "optional");

  // webhooks
  if (!obj.webhooks || typeof obj.webhooks !== "object") {
    throw new Error("Definition must have a 'webhooks' object");
  }
  const wh = obj.webhooks as Record<string, unknown>;
  requireString(wh, "description");
  requireStringArray(wh, "events");
  requireStringArray(wh, "actions");

  // prompts
  if (!obj.prompts || typeof obj.prompts !== "object") {
    throw new Error("Definition must have a 'prompts' object");
  }
  const prompts = obj.prompts as Record<string, unknown>;
  requireString(prompts, "webhook");
  requireString(prompts, "schedule");

  requireString(obj, "defaultSchedule");

  // state (optional)
  if (obj.state !== undefined) {
    if (typeof obj.state !== "object" || obj.state === null) {
      throw new Error("'state' must be an object if present");
    }
    const state = obj.state as Record<string, unknown>;
    requireString(state, "file");
    if (!state.initial || typeof state.initial !== "object") {
      throw new Error("'state.initial' must be an object");
    }
  }

  // params
  if (!obj.params || typeof obj.params !== "object") {
    throw new Error("Definition must have a 'params' object");
  }
  const params = obj.params as Record<string, unknown>;
  for (const [key, val] of Object.entries(params)) {
    validateParamDefinition(key, val);
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
  if (p.webhookFilter !== undefined) {
    if (!p.webhookFilter || typeof p.webhookFilter !== "object") {
      throw new Error(`Param "${key}" webhookFilter must be an object`);
    }
    const wf = p.webhookFilter as Record<string, unknown>;
    if (typeof wf.field !== "string") {
      throw new Error(`Param "${key}" webhookFilter.field must be a string`);
    }
    if (wf.wrap !== undefined && wf.wrap !== "array") {
      throw new Error(`Param "${key}" webhookFilter.wrap must be "array" if present`);
    }
  }
  if (p.credential !== undefined && typeof p.credential !== "string") {
    throw new Error(`Param "${key}" credential must be a string`);
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
