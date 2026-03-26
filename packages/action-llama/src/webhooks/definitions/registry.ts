import type { WebhookDefinition } from "./schema.js";
import { github } from "./github.js";
import { sentry } from "./sentry.js";
import { slack } from "./slack.js";
import { twitter } from "./twitter.js";

const definitions: WebhookDefinition[] = [github, sentry, slack, twitter];

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
