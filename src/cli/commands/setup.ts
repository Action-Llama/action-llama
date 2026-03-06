import { resolve } from "path";
import { existsSync } from "fs";
import { input, confirm } from "@inquirer/prompts";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, listCredentialInstances, writeCredentialFields } from "../../shared/credentials.js";
import type { CredentialDefinition } from "../../credentials/schema.js";

// Webhook secret credential types — these support multiple named instances
const WEBHOOK_SECRET_TYPES: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
};

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "PLAYBOOK.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al setup' from the project root (the parent directory).`
    );
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first, then re-run setup.");
    return;
  }

  // Collect all credential refs from agents
  const credentialRefs = new Set<string>();

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const ref of config.credentials) {
      credentialRefs.add(ref);
    }
  }

  // Detect which webhook sources are in use
  const webhookSources = new Set<string>();
  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const filter of config.webhooks?.filters || []) {
      webhookSources.add(filter.source);
    }
  }

  const totalItems = credentialRefs.size + webhookSources.size;
  if (totalItems === 0) {
    console.log("No credentials required by any agent.");
    return;
  }

  console.log(`\nChecking ${credentialRefs.size} credential(s)...\n`);

  let okCount = 0;
  let promptedCount = 0;

  for (const ref of credentialRefs) {
    const { type, instance } = parseCredentialRef(ref);
    const def = resolveCredential(type);

    if (credentialExists(type, instance)) {
      console.log(`  [ok] ${def.label} (${ref})`);
      okCount++;
      continue;
    }

    const result = await promptCredential(def, instance);
    if (result && Object.keys(result.values).length > 0) {
      writeCredentialFields(type, instance, result.values);
      promptedCount++;
    }
  }

  // Handle webhook secrets separately — these support multiple named instances
  for (const source of webhookSources) {
    const credType = WEBHOOK_SECRET_TYPES[source];
    if (!credType) continue;

    const def = resolveCredential(credType);
    const instances = listCredentialInstances(credType);

    if (instances.length > 0) {
      for (const inst of instances) {
        console.log(`  [ok] ${def.label} (${credType}:${inst})`);
        okCount++;
      }

      const addMore = await confirm({
        message: `Add another ${def.label}? (for a different org/project)`,
        default: false,
      });

      if (addMore) {
        const added = await promptWebhookSecret(def, credType);
        if (added) promptedCount++;
      }
    } else {
      const result = await promptWebhookSecret(def, credType);
      if (result) promptedCount++;
    }
  }

  console.log(`\nDone. ${okCount} already present, ${promptedCount} configured.`);
}

async function promptWebhookSecret(def: CredentialDefinition, credType: string): Promise<boolean> {
  const name = await input({
    message: `${def.label} — name (e.g. "my-org", "default"):`,
    default: "default",
    validate: (v: string) => {
      const trimmed = v.trim();
      if (!trimmed) return "Name is required";
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return "Use only letters, numbers, hyphens, and underscores";
      if (credentialExists(credType, trimmed)) return `"${trimmed}" already exists`;
      return true;
    },
  });

  const result = await promptCredential(def, name.trim());
  if (result && Object.keys(result.values).length > 0) {
    writeCredentialFields(credType, name.trim(), result.values);
    return true;
  }
  return false;
}
