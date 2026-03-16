/**
 * Environment variable interpolation for preflight params.
 *
 * Replaces `${VAR_NAME}` tokens in string values with the corresponding
 * value from the provided env map. Nested objects and arrays are traversed
 * recursively; non-string leaves are returned as-is.
 */

const ENV_VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g;

export function interpolateString(template: string, env: Record<string, string>): string {
  return template.replace(ENV_VAR_RE, (_match, name: string) => {
    return env[name] ?? "";
  });
}

export function interpolateParams(
  params: Record<string, unknown>,
  env: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = interpolateValue(value, env);
  }
  return result;
}

function interpolateValue(value: unknown, env: Record<string, string>): unknown {
  if (typeof value === "string") {
    return interpolateString(value, env);
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateValue(v, env));
  }
  if (value !== null && typeof value === "object") {
    return interpolateParams(value as Record<string, unknown>, env);
  }
  return value;
}
