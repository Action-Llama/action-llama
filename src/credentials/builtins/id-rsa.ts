import type { CredentialDefinition, CredentialPromptResult } from "../schema.js";
import { input, confirm, select } from "@inquirer/prompts";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const idRsa: CredentialDefinition = {
  id: "id_rsa",
  label: "SSH Private Key",
  description: "For git clone/push over SSH",
  filename: "id_rsa",
  fields: [
    { name: "key", label: "Private Key", description: "SSH private key contents", secret: true },
  ],
  // No envVars — SSH key is mounted as a file

  async prompt(existing) {
    if (existing?.key) {
      const reuse = await confirm({
        message: `Found existing SSH key in ${CREDENTIALS_DIR}/id_rsa. Use it?`,
        default: true,
      });
      if (reuse) return { values: existing };
    }

    const method = await select({
      message: "How would you like to provide your SSH private key?",
      choices: [
        { name: "Read from file", value: "file" as const },
        { name: "Paste key directly", value: "paste" as const },
        { name: "Skip (use system SSH config)", value: "skip" as const },
      ],
    });

    if (method === "skip") {
      console.log("No SSH key configured — git will use your system SSH config.\n");
      return undefined;
    }

    if (method === "file") {
      const defaultPath = resolve(process.env.HOME || "~", ".ssh", "id_rsa");
      const keyPath = await input({
        message: "Path to SSH private key:",
        default: existsSync(defaultPath) ? defaultPath : "",
        validate: (v) => (v.trim().length > 0 ? true : "Path is required"),
      });

      const resolvedPath = resolve(keyPath.trim());
      if (!existsSync(resolvedPath)) {
        throw new Error(`SSH key not found at ${resolvedPath}`);
      }

      const content = readFileSync(resolvedPath, "utf-8");
      console.log("SSH key loaded.\n");
      return { values: { key: content } };
    }

    // paste
    const pasted = await input({
      message: "Paste your SSH private key (entire content, then press Enter):",
      validate: (v) => {
        const trimmed = v.trim();
        if (!trimmed) return "Key is required";
        if (!trimmed.includes("PRIVATE KEY")) return "Does not look like a private key — expected a PEM-formatted key";
        return true;
      },
    });

    console.log("SSH key loaded.\n");
    return { values: { key: pasted.trim() } };
  },
};

export default idRsa;
