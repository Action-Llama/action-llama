import { resolve } from "path";
import { execSync } from "child_process";
import { runSetup } from "../../setup/prompts.js";
import { writeCredential, loadCredential } from "../../shared/credentials.js";
import { scaffoldProject } from "../../setup/scaffold.js";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

export async function execute(name: string): Promise<void> {
  const projectPath = resolve(process.cwd(), name);

  const { globalConfig, secrets } = await runSetup();

  console.log("\n--- Writing configuration ---\n");

  // Only write credentials if they're new or changed
  if (secrets.githubToken && secrets.githubToken !== loadCredential("github-token")) {
    writeCredential("github-token", secrets.githubToken);
    console.log(`  Wrote ${CREDENTIALS_DIR}/github-token`);
  } else {
    console.log(`  GitHub token unchanged`);
  }

  if (secrets.anthropicKey && secrets.anthropicKey !== loadCredential("anthropic-key")) {
    writeCredential("anthropic-key", secrets.anthropicKey);
    console.log(`  Wrote ${CREDENTIALS_DIR}/anthropic-key`);
  } else if (secrets.anthropicKey) {
    console.log(`  Anthropic key unchanged`);
  } else {
    console.log("  Using existing pi auth (no key file needed)");
  }

  if (secrets.sshKey && secrets.sshKey !== loadCredential("id_rsa")) {
    writeCredential("id_rsa", secrets.sshKey.trimEnd());
    console.log(`  Wrote ${CREDENTIALS_DIR}/id_rsa`);
  } else if (loadCredential("id_rsa")) {
    console.log(`  SSH key unchanged`);
  }

  scaffoldProject(projectPath, globalConfig, [], name);

  console.log(`  Wrote ${projectPath}/package.json`);
  console.log(`  Wrote ${projectPath}/AGENTS.md`);
  if (Object.keys(globalConfig).length > 0) {
    console.log(`  Wrote ${projectPath}/config.json`);
  }
  console.log(`  Created state directories`);

  console.log("\n--- Installing dependencies ---\n");
  execSync("npm install", { cwd: projectPath, stdio: "inherit" });

  console.log(`
Setup complete!

  Credentials: ${CREDENTIALS_DIR}/
  Project:     ${projectPath}/

Next steps:
  cd ${name}
  Create agents by following the docs: https://github.com/action-llama/action-llama/blob/main/docs/creating-agents.md
  npx al start
`);
}
