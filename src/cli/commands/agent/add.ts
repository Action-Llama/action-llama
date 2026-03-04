import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";
import { select } from "@inquirer/prompts";
import { loadCredential, writeCredential } from "../../../shared/credentials.js";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../../shared/config.js";
import { validateGitHubToken } from "../../../setup/validators.js";
import { runAddAgent } from "../../../setup/prompts.js";
import { scaffoldAgent } from "../../../setup/scaffold.js";
import { CREDENTIALS_DIR } from "../../../shared/paths.js";
import { loadDefinition, listBuiltinDefinitions } from "../../../agents/definitions/loader.js";

export async function execute(opts: { project: string; definition?: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  if (!existsSync(projectPath)) {
    throw new Error(`Project not found: ${projectPath}`);
  }

  // Load GitHub token
  const githubToken = loadCredential("github-token");
  if (!githubToken) {
    throw new Error(
      `GitHub token not found. Run "al init" first or add ${CREDENTIALS_DIR}/github-token.`
    );
  }

  console.log("Validating GitHub token...");
  const { user: githubUser, repos: availableRepos } = await validateGitHubToken(githubToken);
  console.log(`Authenticated as: ${githubUser} (${availableRepos.length} repos found)\n`);

  // Discover existing agents and load model config from first one
  const existingAgentNames = discoverAgents(projectPath);
  if (existingAgentNames.length === 0) {
    throw new Error(
      `No existing agents found in ${projectPath}. Use "al init" to set up a new project.`
    );
  }

  const firstAgent = loadAgentConfig(projectPath, existingAgentNames[0]);
  const modelConfig = firstAgent.model;

  // Load definition — from argument or interactive selection
  let definition;
  if (opts.definition) {
    definition = loadDefinition(opts.definition);
  } else {
    const builtinDefs = listBuiltinDefinitions();
    const selectedName = await select({
      message: "Agent type:",
      choices: builtinDefs.map((d) => ({
        name: `${d.name} — ${d.label} (${d.description})`,
        value: d.name,
      })),
    });
    definition = loadDefinition(selectedName);
  }

  // Run interactive prompt
  const { agent, secrets } = await runAddAgent({
    definition,
    availableRepos,
    githubUser,
    modelConfig,
    existingAgentNames,
  });

  console.log("\n--- Writing configuration ---\n");

  // Write new credentials
  if (secrets.sentryToken && secrets.sentryToken !== loadCredential("sentry-token")) {
    writeCredential("sentry-token", secrets.sentryToken);
    console.log(`  Wrote ${CREDENTIALS_DIR}/sentry-token`);
  }

  if (secrets.githubWebhookSecret) {
    writeCredential("github-webhook-secret", secrets.githubWebhookSecret);
    console.log(`  Wrote ${CREDENTIALS_DIR}/github-webhook-secret`);
  }

  // Update global config if agent uses webhooks and config doesn't reference the secret yet
  if (agent.config.webhooks) {
    const globalConfig = loadGlobalConfig(projectPath);
    if (!globalConfig.webhooks?.githubSecretCredential) {
      globalConfig.webhooks = { ...globalConfig.webhooks, githubSecretCredential: "github-webhook-secret" };
      writeFileSync(
        resolve(projectPath, "config.json"),
        JSON.stringify(globalConfig, null, 2) + "\n"
      );
      console.log(`  Updated ${projectPath}/config.json`);
    }
  }

  // Scaffold the agent
  scaffoldAgent(projectPath, agent);

  console.log(`  Wrote ${projectPath}/${agent.name}/config.json`);
  console.log(`  Wrote ${projectPath}/${agent.name}/AGENTS.md`);
  console.log(`  Created state directory`);

  console.log(`
Agent "${agent.name}" added successfully!

  Edit ${projectPath}/${agent.name}/AGENTS.md to customize agent behavior.
  Restart with: al start -p ${projectPath}
`);
}
