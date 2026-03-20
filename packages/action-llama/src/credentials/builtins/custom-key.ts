import type { CredentialDefinition } from "../schema.js";
import { password, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const customKey: CredentialDefinition = {
  id: "custom_key",
  label: "Custom LLM Provider API Credential",
  description: "API key for custom LLM providers",
  fields: [
    { name: "token", label: "API Key", description: "API key for your custom LLM provider", secret: true },
  ],

  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing custom credential in ${CREDENTIALS_DIR}/custom_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        console.log(`Using existing custom API key.\n`);
        return { values: existing, params: { authType: "api_key" } };
      }
    }

    const token = (await password({
      message: "Custom LLM provider API key:",
      mask: "*",
      validate: (v) => {
        v = v.trim();
        if (v.length === 0) return "API key is required";
        return true;
      },
    })).trim();

    console.log("Custom API key saved. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "api_key" } };
  },
};

export default customKey;