import type { CredentialDefinition } from "../schema.js";
import { input, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const openrouterKey: CredentialDefinition = {
  id: "openrouter_key",
  label: "OpenRouter API Credential",
  description: "API key for OpenRouter (multi-provider access)",
  fields: [
    { name: "token", label: "API Key", description: "OpenRouter API key (sk-or-...)", secret: true },
  ],

  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing OpenRouter credential in ${CREDENTIALS_DIR}/openrouter_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        console.log(`Using existing OpenRouter API key.\n`);
        return { values: existing, params: { authType: "api_key" } };
      }
    }

    const token = (await input({
      message: "OpenRouter API key:",
      validate: (v) => {
        v = v.trim();
        if (v.length === 0) return "API key is required";
        if (!v.startsWith("sk-or-")) return "API key should start with 'sk-or-'";
        return true;
      },
    })).trim();

    console.log("OpenRouter API key saved. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "api_key" } };
  },
};

export default openrouterKey;