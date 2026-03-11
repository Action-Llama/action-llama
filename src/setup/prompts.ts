import { input, select, confirm, password } from "@inquirer/prompts";
import { validateGitHubToken } from "./validators.js";
import { writeCredentialFields } from "../shared/credentials.js";
import type { GlobalConfig, ModelConfig } from "../shared/config.js";
import { resolveCredential } from "../credentials/registry.js";
import { promptCredential } from "../credentials/prompter.js";
import type { CredentialDefinition, CredentialPromptResult } from "../credentials/schema.js";

/**
 * Write credential values to disk using the directory-based layout.
 */
async function writeCredentialValues(def: CredentialDefinition, values: Record<string, string>, instance: string = "default"): Promise<void> {
  if (Object.keys(values).length === 0) return; // e.g. pi_auth
  await writeCredentialFields(def.id, instance, values);
}

/**
 * Prompt for a credential and write it to disk.
 * Returns the prompt result (values + optional params), or undefined if skipped.
 */
async function promptAndStoreCredential(
  def: CredentialDefinition,
  instance: string = "default"
): Promise<CredentialPromptResult | undefined> {
  const result = await promptCredential(def, instance);
  if (result && Object.keys(result.values).length > 0) {
    await writeCredentialValues(def, result.values, instance);
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
  const githubTokenDef = resolveCredential("github_token");
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

  // SSH key + git identity
  console.log("--- Git SSH Key & Identity ---\n");
  const gitSshDef = resolveCredential("git_ssh");
  const sshKeyResult = await promptAndStoreCredential(gitSshDef);
  const sshKey = sshKeyResult?.values.id_rsa;

  // Anthropic auth
  console.log("\n--- Anthropic Auth ---\n");
  const anthropicDef = resolveCredential("anthropic_key");
  const anthropicResult = await promptAndStoreCredential(anthropicDef);
  const anthropicKey = anthropicResult?.values.token;

  // Step 2: LLM defaults
  console.log("\n--- Step 2: LLM Defaults ---\n");

  const provider = await select({
    message: "Select LLM provider:",
    choices: [
      { name: "Anthropic Claude (recommended)", value: "anthropic" },
      { name: "OpenAI GPT", value: "openai" },
      { name: "Groq", value: "groq" },
      { name: "Google Gemini", value: "google" },
      { name: "xAI Grok", value: "xai" },
      { name: "Mistral", value: "mistral" },
      { name: "OpenRouter (multi-provider)", value: "openrouter" },
      { name: "Other (custom provider)", value: "custom" },
    ],
    default: "anthropic",
  });

  let modelName: string;
  if (provider === "anthropic") {
    modelName = await select({
      message: "Select Anthropic model:",
      choices: [
        { name: "claude-sonnet-4-20250514 (recommended)", value: "claude-sonnet-4-20250514" },
        { name: "claude-opus-4-20250514", value: "claude-opus-4-20250514" },
        { name: "claude-haiku-3-5-20241022", value: "claude-haiku-3-5-20241022" },
      ],
      default: "claude-sonnet-4-20250514",
    });
  } else if (provider === "openai") {
    modelName = await select({
      message: "Select OpenAI model:",
      choices: [
        { name: "gpt-4o (recommended)", value: "gpt-4o" },
        { name: "gpt-4o-mini", value: "gpt-4o-mini" },
        { name: "gpt-4-turbo", value: "gpt-4-turbo" },
        { name: "o1-preview", value: "o1-preview" },
        { name: "o1-mini", value: "o1-mini" },
      ],
      default: "gpt-4o",
    });
  } else {
    modelName = await input({
      message: `Enter ${provider} model name:`,
      default: provider === "groq" ? "llama-3.3-70b-versatile" :
                provider === "google" ? "gemini-2.0-flash-exp" :
                provider === "xai" ? "grok-beta" :
                provider === "mistral" ? "mistral-large-2411" :
                provider === "openrouter" ? "anthropic/claude-3.5-sonnet" :
                "model-name",
    });
  }

  // Only prompt for thinking level for providers that support reasoning
  const providersWithReasoning = ["anthropic"];
  let thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
  if (providersWithReasoning.includes(provider)) {
    thinkingLevel = await select({
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
  }

  // Prompt for provider-specific credentials
  if (provider !== "anthropic" && provider !== "openai") {
    const credentialType = `${provider}_key`;
    try {
      const existingCred = resolveCredential(credentialType);
      await promptAndStoreCredential(existingCred);
    } catch {
      // If credential type doesn't exist in registry, prompt manually
      const apiKey = await password({
        message: `Enter ${provider} API key:`,
      });
      if (apiKey) {
        await writeCredentialFields(credentialType, "default", { token: apiKey });
      }
    }
  }

  // Build global config
  const globalConfig: GlobalConfig = {
    model: {
      provider,
      model: modelName,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      authType: "api_key",
    },
  };

  return {
    globalConfig,
    secrets: {
      githubToken,
      anthropicKey,
      sshKey,
    },
  };
}
