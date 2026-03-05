import { resolve } from "path";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { loadCredential, writeCredential, writeStructuredCredential } from "../../shared/credentials.js";
import type { CredentialDefinition } from "../../credentials/schema.js";

function writeCredentialValues(def: CredentialDefinition, values: Record<string, string>): void {
  if (Object.keys(values).length === 0) return;
  if (def.fields.length === 1) {
    writeCredential(def.filename, values[def.fields[0].name]);
  } else {
    writeStructuredCredential(def.filename, values);
  }
}

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first, then re-run setup.");
    return;
  }

  // Collect all credential IDs from agents and global config
  const credentialIds = new Set<string>();

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const id of config.credentials) {
      credentialIds.add(id);
    }
  }

  const globalConfig = loadGlobalConfig(projectPath);
  if (globalConfig.webhooks?.secretCredentials) {
    for (const id of Object.values(globalConfig.webhooks.secretCredentials)) {
      credentialIds.add(id);
    }
  }

  if (credentialIds.size === 0) {
    console.log("No credentials required by any agent.");
    return;
  }

  console.log(`\nChecking ${credentialIds.size} credential(s)...\n`);

  let okCount = 0;
  let promptedCount = 0;

  for (const id of credentialIds) {
    const def = resolveCredential(id);
    const existing = loadCredential(def.filename);

    if (existing) {
      console.log(`  [ok] ${def.label}`);
      okCount++;
      continue;
    }

    const result = await promptCredential(def);
    if (result && Object.keys(result.values).length > 0) {
      writeCredentialValues(def, result.values);
      promptedCount++;
    }
  }

  console.log(`\nDone. ${okCount} already present, ${promptedCount} configured.`);
}
