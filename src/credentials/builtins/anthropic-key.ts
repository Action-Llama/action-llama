import type { CredentialDefinition, CredentialPromptResult } from "../schema.js";
import { input, select, confirm } from "@inquirer/prompts";
import { validateAnthropicApiKey, validateOAuthTokenFormat } from "../../setup/validators.js";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const anthropicKey: CredentialDefinition = {
  id: "anthropic_key",
  label: "Anthropic API Credential",
  description: "API key, OAuth token, or pi auth for Claude access",
  fields: [
    { name: "token", label: "API Key / OAuth Token", description: "Anthropic credential", secret: true },
  ],
  // No envVars — anthropic_key is read directly by container-entry.ts via the SDK

  // Custom prompt: supports three auth methods (pi_auth, api_key, oauth_token)
  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing Anthropic credential in ${CREDENTIALS_DIR}/anthropic_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        const authType = existing.token.includes("sk-ant-oat") ? "oauth_token" : "api_key";
        console.log(`Using existing credential (detected type: ${authType}).\n`);
        return { values: existing, params: { authType } };
      }
    }

    const authMethod = await select({
      message: "How do you want to authenticate with Anthropic?",
      choices: [
        { name: "Use existing pi auth (already ran `pi /login` or `claude setup-token`)", value: "pi_auth" as const },
        { name: "Enter an API key (sk-ant-api...)", value: "api_key" as const },
        { name: "Enter an OAuth token (sk-ant-oat...)", value: "oauth_token" as const },
      ],
    });

    if (authMethod === "pi_auth") {
      const { AuthStorage, ModelRegistry } = await import("@mariozechner/pi-coding-agent");
      const authStorage = AuthStorage.create();
      const registry = new ModelRegistry(authStorage);
      const available = await registry.getAvailable();
      const hasAnthropic = available.some((m: any) => m.provider === "anthropic");
      if (!hasAnthropic) {
        throw new Error(
          "No Anthropic credentials found in pi auth storage (~/.pi/agent/auth.json). " +
          "Run `pi /login` first, or choose a different auth method."
        );
      }
      console.log("Found existing Anthropic credentials in pi auth storage.\n");
      // pi_auth doesn't write a credential file — return undefined to skip storage
      return { values: {}, params: { authType: "pi_auth" } };
    }

    if (authMethod === "api_key") {
      const token = (await input({
        message: "Anthropic API key:",
        validate: (v) => (v.trim().length > 0 ? true : "Key is required"),
      })).trim();
      console.log("Validating API key...");
      await validateAnthropicApiKey(token);
      console.log("API key validated.\n");
      return { values: { token }, params: { authType: "api_key" } };
    }

    // oauth_token
    const token = (await input({
      message: "Anthropic OAuth token (from `claude setup-token`):",
      validate: (v) => (v.trim().length > 0 ? true : "Token is required"),
    })).trim();
    validateOAuthTokenFormat(token);
    console.log("OAuth token format looks valid. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "oauth_token" } };
  },
};

export default anthropicKey;
