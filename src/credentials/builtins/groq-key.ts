import type { CredentialDefinition } from "../schema.js";
import { password, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const groqKey: CredentialDefinition = {
  id: "groq_key",
  label: "Groq API Credential",
  description: "API key for Groq models (fast inference)",
  fields: [
    { name: "token", label: "API Key", description: "Groq API key (gsk_...)", secret: true },
  ],

  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing Groq credential in ${CREDENTIALS_DIR}/groq_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        console.log(`Using existing Groq API key.\n`);
        return { values: existing, params: { authType: "api_key" } };
      }
    }

    const token = (await password({
      message: "Groq API key:",
      mask: "*",
      validate: (v) => {
        v = v.trim();
        if (v.length === 0) return "API key is required";
        if (!v.startsWith("gsk_")) return "API key should start with 'gsk_'";
        return true;
      },
    })).trim();

    console.log("Groq API key saved. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "api_key" } };
  },
};

export default groqKey;