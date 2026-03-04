import { resolve } from "path";
import { runSetup } from "../../setup/prompts.js";
import { writeCredential, loadCredential } from "../../shared/credentials.js";
import { scaffoldProject } from "../../setup/scaffold.js";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

export async function execute(name: string): Promise<void> {
  const projectPath = resolve(process.cwd(), name);

  const { globalConfig, agents, secrets } = await runSetup();

  console.log("\n--- Writing configuration ---\n");

  // Only write credentials if they're new or changed
  if (secrets.githubToken && secrets.githubToken !== loadCredential("github-token")) {
    writeCredential("github-token", secrets.githubToken);
    console.log(`  Wrote ${CREDENTIALS_DIR}/github-token`);
  } else {
    console.log(`  GitHub token unchanged`);
  }

  if (secrets.sentryToken && secrets.sentryToken !== loadCredential("sentry-token")) {
    writeCredential("sentry-token", secrets.sentryToken);
    console.log(`  Wrote ${CREDENTIALS_DIR}/sentry-token`);
  } else if (secrets.sentryToken) {
    console.log(`  Sentry token unchanged`);
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

  if (secrets.githubWebhookSecret && secrets.githubWebhookSecret !== loadCredential("github-webhook-secret")) {
    writeCredential("github-webhook-secret", secrets.githubWebhookSecret);
    console.log(`  Wrote ${CREDENTIALS_DIR}/github-webhook-secret`);
  } else if (secrets.githubWebhookSecret) {
    console.log(`  GitHub webhook secret unchanged`);
  }

  scaffoldProject(projectPath, globalConfig, agents, name);

  const agentNames = agents.map((a) => a.name);
  console.log(`  Wrote ${projectPath}/package.json`);
  if (Object.keys(globalConfig).length > 0) {
    console.log(`  Wrote ${projectPath}/config.json`);
  }
  for (const name of agentNames) {
    console.log(`  Wrote ${projectPath}/${name}/config.json`);
    console.log(`  Wrote ${projectPath}/${name}/AGENTS.md`);
  }
  console.log(`  Created state directories`);

  console.log(`
Setup complete!

  Credentials: ${CREDENTIALS_DIR}/
  Project:     ${projectPath}/
  Agents:      ${agentNames.join(", ")}

  Edit <agent>/AGENTS.md to customize agent behavior.

Next steps:
  cd ${name}
  npm install
  npx al start
`);
}
