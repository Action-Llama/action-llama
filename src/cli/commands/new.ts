import { resolve } from "path";
import { execSync } from "child_process";
import { scaffoldProject } from "../../setup/scaffold.js";
import { CREDENTIALS_DIR } from "../../shared/paths.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { writeCredentialFields, loadCredentialField } from "../../shared/credentials.js";
import type { GlobalConfig } from "../../shared/config.js";

export async function execute(name: string): Promise<void> {
  if (!name) throw new Error("Project name is required");
  const projectPath = resolve(process.cwd(), name);

  console.log("\n=== Action Llama — New Project ===\n");

  // Only prompt for the Anthropic credential; other credentials are
  // handled per-agent by `al doctor` (which runs automatically before `al start`).
  console.log("--- Anthropic Auth ---\n");
  const anthropicDef = resolveCredential("anthropic_key");
  const result = await promptCredential(anthropicDef);

  if (result && Object.keys(result.values).length > 0) {
    const existing = loadCredentialField("anthropic_key", "default", "token");
    const newValue = result.values.token;
    if (newValue && newValue !== existing) {
      writeCredentialFields("anthropic_key", "default", result.values);
      console.log(`  Wrote ${CREDENTIALS_DIR}/anthropic_key/default/`);
    } else {
      console.log(`  Anthropic key unchanged`);
    }
  } else {
    console.log("  Using existing pi auth (no key file needed)");
  }

  console.log("\n--- Writing configuration ---\n");

  const globalConfig: GlobalConfig = {};

  scaffoldProject(projectPath, globalConfig, [], name);

  console.log(`  Wrote ${projectPath}/package.json`);
  console.log(`  Wrote ${projectPath}/AGENTS.md`);
  console.log(`  Created state directories`);

  console.log("\n--- Installing dependencies ---\n");
  execSync("npm install", { cwd: projectPath, stdio: "inherit" });

  console.log(`
Setup complete!

  Credentials: ${CREDENTIALS_DIR}/
  Project:     ${projectPath}/

Next steps:
  cd ${name}
  npx al console # Start an interactive console to create agents
  npx al start # Start the gateway
`);
}
