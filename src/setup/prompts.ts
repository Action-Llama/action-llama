import { input, select, confirm } from "@inquirer/prompts";
import { validateGitHubToken } from "./validators.js";
import { writeCredential, writeStructuredCredential } from "../shared/credentials.js";
import type { GlobalConfig, ModelConfig } from "../shared/config.js";
import { resolveCredential } from "../credentials/registry.js";
import { promptCredential } from "../credentials/prompter.js";
import type { CredentialDefinition, CredentialPromptResult } from "../credentials/schema.js";

/**
 * Write credential values to disk based on the definition's field count.
 * Single-field: plain text (backward compatible). Multi-field: JSON.
 */
function writeCredentialValues(def: CredentialDefinition, values: Record<string, string>): void {
  if (Object.keys(values).length === 0) return; // e.g. pi_auth
  if (def.fields.length === 1) {
    const fieldName = def.fields[0].name;
    writeCredential(def.filename, values[fieldName]);
  } else {
    writeStructuredCredential(def.filename, values);
  }
}

/**
 * Prompt for a credential and write it to disk.
 * Returns the prompt result (values + optional params), or undefined if skipped.
 */
async function promptAndStoreCredential(
  def: CredentialDefinition
): Promise<CredentialPromptResult | undefined> {
  const result = await promptCredential(def);
  if (result && Object.keys(result.values).length > 0) {
    writeCredentialValues(def, result.values);
  }
  return result;
}

// --- Full interactive setup (new command) ---

export async function runSetup(): Promise<{
  globalConfig: GlobalConfig;
  secrets: {
    githubToken: string;
    anthropicKey?: string;
    sshKey?: string;
  };
}> {
  console.log("\n=== Action Llama — Setup ===\n");

  // Step 1: Credentials
  console.log("--- Step 1: Credentials ---\n");

  // GitHub token (always required)
  const githubTokenDef = resolveCredential("github-token");
  const githubTokenResult = await promptAndStoreCredential(githubTokenDef);
  if (!githubTokenResult) throw new Error("GitHub token is required");
  const githubToken = githubTokenResult.values.token;

  console.log("Validating GitHub token...");
  try {
    const result = await validateGitHubToken(githubToken);
    console.log(`Authenticated as: ${result.user} (${result.repos.length} repos found)\n`);
  } catch (err: any) {
    throw new Error(`GitHub validation failed: ${err.message}`);
  }

  // SSH key
  console.log("--- Git SSH Key ---\n");
  const sshKeyDef = resolveCredential("id_rsa");
  const sshKeyResult = await promptAndStoreCredential(sshKeyDef);
  const sshKey = sshKeyResult?.values.key;

  // Anthropic auth
  console.log("\n--- Anthropic Auth ---\n");
  const anthropicDef = resolveCredential("anthropic-key");
  const anthropicResult = await promptAndStoreCredential(anthropicDef);
  const anthropicKey = anthropicResult?.values.token;

  // Step 2: LLM defaults
  console.log("\n--- Step 2: LLM Defaults ---\n");

  const modelName = await select({
    message: "Select model:",
    choices: [
      { name: "claude-sonnet-4-20250514 (recommended)", value: "claude-sonnet-4-20250514" },
      { name: "claude-opus-4-20250514", value: "claude-opus-4-20250514" },
      { name: "claude-haiku-3-5-20241022", value: "claude-haiku-3-5-20241022" },
    ],
    default: "claude-sonnet-4-20250514",
  });

  await select({
    message: "Thinking level:",
    choices: [
      { name: "off", value: "off" as const },
      { name: "minimal", value: "minimal" as const },
      { name: "low", value: "low" as const },
      { name: "medium (recommended)", value: "medium" as const },
      { name: "high", value: "high" as const },
    ],
    default: "medium" as const,
  });

  // Build global config
  const globalConfig: GlobalConfig = {};

  return {
    globalConfig,
    secrets: {
      githubToken,
      anthropicKey,
      sshKey,
    },
  };
}
