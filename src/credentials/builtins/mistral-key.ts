import type { CredentialDefinition } from "../schema.js";
import { input, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const mistralKey: CredentialDefinition = {
  id: "mistral_key",
  label: "Mistral AI API Credential", 
  description: "API key for Mistral AI models",
  fields: [
    { name: "token", label: "API Key", description: "Mistral AI API key", secret: true },
  ],

  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing Mistral credential in ${CREDENTIALS_DIR}/mistral_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        console.log(`Using existing Mistral API key.\n`);
        return { values: existing, params: { authType: "api_key" } };
      }
    }

    const token = (await input({
      message: "Mistral AI API key:",
      validate: (v) => {
        v = v.trim();
        if (v.length === 0) return "API key is required";
        return true;
      },
    })).trim();

    console.log("Mistral API key saved. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "api_key" } };
  },
};

export default mistralKey;