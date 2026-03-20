import { parse as parseYAML } from "yaml";

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Frontmatter is delimited by `---` at the start and end.
 * Returns the parsed data and the remaining body.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { data: {}, body: content };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { data: {}, body: content };
  }

  const yamlBlock = trimmed.slice(4, endIdx);
  const body = trimmed.slice(endIdx + 4).replace(/^\r?\n/, "");

  const data = parseYAML(yamlBlock) ?? {};
  if (typeof data !== "object" || Array.isArray(data)) {
    return { data: {}, body: content };
  }

  return { data: data as Record<string, unknown>, body };
}
