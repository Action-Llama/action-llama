import type { CredentialDefinition, CredentialPromptResult } from "../schema.js";
import { input, password, confirm, select } from "@inquirer/prompts";
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
  agentContext: "`GIT_SSH_COMMAND` configured for SSH access; `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` set — `git clone`, `git push`, and `git commit` work directly",

  async prompt(existing) {
    console.log("\n--- Git SSH Credential ---");
    console.log("Agents need an SSH key, author name, and email to clone repos and push commits.\n");

    // If all three fields exist, offer to reuse
    if (existing?.id_rsa && existing?.username && existing?.email) {
      const reuse = await confirm({
        message: `Found existing: ${existing.username} <${existing.email}> with SSH key. Keep it?`,
        default: true,
      });
      if (reuse) return { values: existing };
    }

    // 1. Git author name
    const username = await input({
      message: "Git author name:",
      default: existing?.username || "",
      validate: (v) => (v.trim().length > 0 ? true : "Name is required"),
    });

    // 2. Git author email
    const email = await input({
      message: "Git author email:",
      default: existing?.email || "",
      validate: (v) => (v.trim().length > 0 ? true : "Email is required"),
    });

    // 3. SSH key
    let keyContent: string | undefined;

    if (existing?.id_rsa) {
      const reuse = await confirm({
        message: "Found existing SSH key. Keep it?",
        default: true,
      });
      if (reuse) keyContent = existing.id_rsa;
    }

    if (!keyContent) {
      const method = await select({
        message: "SSH private key:",
        choices: [
          { name: "Read from file", value: "file" as const },
          { name: "Paste key directly", value: "paste" as const },
          { name: "Skip (use system SSH config)", value: "skip" as const },
        ],
      });

      if (method === "skip") {
        console.log(`\nGit identity set: ${username.trim()} <${email.trim()}> (no SSH key)\n`);
        return { values: { username: username.trim(), email: email.trim() } };
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
      } else {
        keyContent = await password({
          message: "Paste your SSH private key (entire content, then press Enter):",
          mask: "*",
          validate: (v) => {
            const trimmed = v.trim();
            if (!trimmed) return "Key is required";
            if (!trimmed.includes("PRIVATE KEY")) return "Does not look like a private key — expected a PEM-formatted key";
            return true;
          },
        });
        keyContent = keyContent.trim();
      }
    }

    console.log(`\nGit identity set: ${username.trim()} <${email.trim()}> with SSH key\n`);
    return { values: { id_rsa: keyContent, username: username.trim(), email: email.trim() } };
  },
};

export default gitSsh;
