import { resolve } from "path";
import { execSync } from "child_process";
import { select } from "@inquirer/prompts";
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

  // Step 1: Choose model provider
  console.log("--- Model Provider ---\n");
  const provider = await select({
    message: "Select model provider:",
    choices: [
      { name: "Anthropic Claude (recommended)", value: "anthropic" },
      { name: "OpenAI GPT/Codex", value: "openai" },
    ],
    default: "anthropic",
  });

  // Step 2: Choose model based on provider
  let model: string;
  let thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;

  if (provider === "openai") {
    console.log("\n--- OpenAI Model ---\n");
    model = await select({
      message: "Select OpenAI model:",
      choices: [
        { name: "gpt-4o (recommended for coding)", value: "gpt-4o" },
        { name: "gpt-4", value: "gpt-4" },
        { name: "o1-preview", value: "o1-preview" },
        { name: "gpt-3.5-turbo", value: "gpt-3.5-turbo" },
      ],
      default: "gpt-4o",
    });

    // OpenAI models don't support extended thinking — omit thinkingLevel
  } else {
    console.log("\n--- Anthropic Model ---\n");
    model = await select({
      message: "Select Claude model:",
      choices: [
        { name: "claude-sonnet-4-20250514 (recommended)", value: "claude-sonnet-4-20250514" },
        { name: "claude-opus-4-20250514", value: "claude-opus-4-20250514" },
        { name: "claude-haiku-3-5-20241022", value: "claude-haiku-3-5-20241022" },
      ],
      default: "claude-sonnet-4-20250514",
    });

    thinkingLevel = "medium";
  }

  // Step 3: Set up credentials
  console.log(`\n--- ${provider === "anthropic" ? "Anthropic" : "OpenAI"} Auth ---\n`);
  
  const credentialType = provider === "anthropic" ? "anthropic_key" : "openai_key";
  const credentialDef = resolveCredential(credentialType);
  const result = await promptCredential(credentialDef);

  if (result && Object.keys(result.values).length > 0) {
    const existing = await loadCredentialField(credentialType, "default", "token");
    const newValue = result.values.token;
    if (newValue && newValue !== existing) {
      await writeCredentialFields(credentialType, "default", result.values);
      console.log(`  Wrote ${CREDENTIALS_DIR}/${credentialType}/default/`);
    } else {
      console.log(`  ${provider === "anthropic" ? "Anthropic" : "OpenAI"} key unchanged`);
    }
  } else {
    if (provider === "anthropic") {
      console.log("  Using existing pi auth (no key file needed)");
    } else {
      console.log("  No API key provided - you'll need to configure it later with 'al doctor'");
    }
  }

  console.log("\n--- Writing configuration ---\n");

  // Derive a short model name from the model ID
  const derivedName = model.includes("sonnet") ? "sonnet"
    : model.includes("opus") ? "opus"
    : model.includes("haiku") ? "haiku"
    : model.includes("gpt-4o") ? "gpt4o"
    : model.includes("gpt-4") ? "gpt4"
    : model.replace(/[-_.]\d{4,}.*$/, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");

  const globalConfig: GlobalConfig = {
    models: {
      [derivedName]: {
        provider,
        model,
        ...(thinkingLevel ? { thinkingLevel } : {}),
        authType: result && Object.keys(result.values).length > 0 ? "api_key" :
                  (provider === "anthropic" ? "pi_auth" : "api_key"),
      },
    },
  };

  scaffoldProject(projectPath, globalConfig, [], name);

  console.log(`  Wrote ${projectPath}/package.json`);
  console.log(`  Linked ${projectPath}/AGENTS.md`);
  console.log(`  Created state directories`);

  console.log("\n--- Installing dependencies ---\n");
  execSync("npm install", { cwd: projectPath, stdio: "inherit" });

  console.log(`
Setup complete!

  Provider:    ${provider}
  Model:       ${model}
  Credentials: ${CREDENTIALS_DIR}/
  Project:     ${projectPath}/

Next steps:
  cd ${name}
  npx al chat    # Start an interactive chat to create agents
  npx al start # Start the gateway
`);
}
