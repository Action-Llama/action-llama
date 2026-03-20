import type { CredentialDefinition } from "../schema.js";
import { password, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const googleKey: CredentialDefinition = {
  id: "google_key",
  label: "Google AI API Credential",
  description: "API key for Google Gemini models",
  fields: [
    { name: "token", label: "API Key", description: "Google AI Studio API key", secret: true },
  ],

  async prompt(existing) {
    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing Google credential in ${CREDENTIALS_DIR}/google_key/. Use it?`,
        default: true,
      });
      if (reuse) {
        console.log(`Using existing Google API key.\n`);
        return { values: existing, params: { authType: "api_key" } };
      }
    }

    const token = (await password({
      message: "Google AI Studio API key:",
      mask: "*",
      validate: (v) => {
        v = v.trim();
        if (v.length === 0) return "API key is required";
        return true;
      },
    })).trim();

    console.log("Google API key saved. It will be verified on first agent run.\n");
    return { values: { token }, params: { authType: "api_key" } };
  },
};

export default googleKey;