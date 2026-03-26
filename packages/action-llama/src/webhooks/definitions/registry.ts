import type { WebhookDefinition } from "./schema.js";
import { github } from "./github.js";
import { sentry } from "./sentry.js";
import { discord } from "./discord.js";

const definitions: WebhookDefinition[] = [github, sentry, discord];

export function resolveWebhookDefinition(id: string): WebhookDefinition {
  const def = definitions.find((d) => d.id === id);
  if (!def) {
    throw new Error(`Unknown webhook definition: "${id}". Available: ${definitions.map((d) => d.id).join(", ")}`);
  }
  return def;
}

export function listWebhookDefinitions(): WebhookDefinition[] {
  return [...definitions];
}
