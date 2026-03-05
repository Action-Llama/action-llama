import { resolve } from "path";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, writeCredentialFields } from "../../shared/credentials.js";
import type { CredentialDefinition } from "../../credentials/schema.js";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first, then re-run setup.");
    return;
  }

  // Collect all credential refs from agents and global config
  const credentialRefs = new Set<string>();

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const ref of config.credentials) {
      credentialRefs.add(ref);
    }
  }

  const globalConfig = loadGlobalConfig(projectPath);
  if (globalConfig.webhooks?.secretCredentials) {
    for (const ref of Object.values(globalConfig.webhooks.secretCredentials)) {
      credentialRefs.add(ref);
    }
  }

  if (credentialRefs.size === 0) {
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

  console.log(`\nDone. ${okCount} already present, ${promptedCount} configured.`);
}
