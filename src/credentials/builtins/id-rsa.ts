import type { CredentialDefinition, CredentialPromptResult } from "../schema.js";
import { input, confirm, select } from "@inquirer/prompts";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const gitSsh: CredentialDefinition = {
  id: "git_ssh",
  label: "SSH Key & Git Identity",
  description: "SSH private key for git clone/push, plus commit author name and email",
  fields: [
    { name: "id_rsa", label: "Private Key", description: "SSH private key contents", secret: true },
    { name: "username", label: "Git Author Name", description: "Name used for git commits", secret: false },
    { name: "email", label: "Git Author Email", description: "Email used for git commits", secret: false },
  ],
  // No envVars — SSH key is mounted as a file; git identity is injected by the runner via GIT_AUTHOR_NAME/EMAIL

  async prompt(existing) {
    let keyContent: string | undefined;

    if (existing?.id_rsa) {
      const reuse = await confirm({
        message: `Found existing SSH key in ${CREDENTIALS_DIR}/git_ssh/. Use it?`,
        default: true,
      });
      if (reuse) {
        keyContent = existing.id_rsa;
      }
    }

    if (!keyContent) {
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
        // Still prompt for git identity — needed even without SSH key
        const identity = await promptGitIdentity(existing);
        if (identity) {
          return { values: identity };
        }
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

        keyContent = readFileSync(resolvedPath, "utf-8");
        console.log("SSH key loaded.\n");
      } else {
        // paste
        keyContent = await input({
          message: "Paste your SSH private key (entire content, then press Enter):",
          validate: (v) => {
            const trimmed = v.trim();
            if (!trimmed) return "Key is required";
            if (!trimmed.includes("PRIVATE KEY")) return "Does not look like a private key — expected a PEM-formatted key";
            return true;
          },
        });
        keyContent = keyContent.trim();
        console.log("SSH key loaded.\n");
      }
    }

    const identity = await promptGitIdentity(existing);
    const values: Record<string, string> = { id_rsa: keyContent };
    if (identity?.username) values.username = identity.username;
    if (identity?.email) values.email = identity.email;

    return { values };
  },
};

async function promptGitIdentity(existing?: Record<string, string>): Promise<Record<string, string> | undefined> {
  const existingName = existing?.username;
  const existingEmail = existing?.email;

  if (existingName && existingEmail) {
    const reuse = await confirm({
      message: `Git identity: ${existingName} <${existingEmail}>. Keep it?`,
      default: true,
    });
    if (reuse) return { username: existingName, email: existingEmail };
  }

  console.log("\nGit author identity (used for commits):\n");

  const name = await input({
    message: "Git author name:",
    default: existingName || "",
    validate: (v) => (v.trim().length > 0 ? true : "Name is required"),
  });

  const email = await input({
    message: "Git author email:",
    default: existingEmail || "",
    validate: (v) => (v.trim().length > 0 ? true : "Email is required"),
  });

  console.log(`Git identity set: ${name.trim()} <${email.trim()}>\n`);
  return { username: name.trim(), email: email.trim() };
}

export default gitSsh;
