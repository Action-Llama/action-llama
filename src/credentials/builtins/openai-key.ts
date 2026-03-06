import type { CredentialDefinition } from "../schema.js";
import { input, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const openaiKey: CredentialDefinition = {
  id: "openai_key",
  label: "OpenAI API Credential",
  description: "API key for OpenAI GPT models (including Codex)",
  fields: [
    { name: "token", label: "API Key", description: "OpenAI API key (sk-...)", secret: true },
  ],
  // No envVars — openai_key is read directly by the agent runner

  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing OpenAI credential in ${CREDENTIALS_DIR}/openai_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        console.log(`Using existing OpenAI API key.\n`);
        return { values: existing, params: { authType: "api_key" } };
      }
    }

    const token = (await input({
      message: "OpenAI API key:",
      validate: (v) => {
        v = v.trim();
        if (v.length === 0) return "API key is required";
        if (!v.startsWith("sk-")) return "API key should start with 'sk-'";
        return true;
      },
    })).trim();

    console.log("OpenAI API key saved. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "api_key" } };
  },
};

export default openaiKey;