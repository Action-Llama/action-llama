import type { CredentialDefinition } from "../schema.js";
import { input, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const xaiKey: CredentialDefinition = {
  id: "xai_key",
  label: "xAI API Credential",
  description: "API key for xAI Grok models",
  fields: [
    { name: "token", label: "API Key", description: "xAI API key", secret: true },
  ],

  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing xAI credential in ${CREDENTIALS_DIR}/xai_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        console.log(`Using existing xAI API key.\n`);
        return { values: existing, params: { authType: "api_key" } };
      }
    }

    const token = (await input({
      message: "xAI API key:",
      validate: (v) => {
        v = v.trim();
        if (v.length === 0) return "API key is required";
        if (!v.startsWith("xai-")) return "API key should start with 'xai-'";
        return true;
      },
    })).trim();

    console.log("xAI API key saved. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "api_key" } };
  },
};

export default xaiKey;