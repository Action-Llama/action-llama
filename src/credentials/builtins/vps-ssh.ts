import type { CredentialDefinition, CredentialPromptResult } from "../schema.js";
import { input, password, confirm, select } from "@inquirer/prompts";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";

const vpsSsh: CredentialDefinition = {
  id: "vps_ssh",
  label: "VPS SSH Key",
  description: "SSH keypair for connecting to VPS instances provisioned by Action Llama",
  fields: [
    { name: "private_key", label: "Private Key", description: "SSH private key (PEM)", secret: true },
    { name: "public_key", label: "Public Key", description: "SSH public key", secret: false },
  ],
  // No envVars or agentContext — used by the CLI for provisioning, not injected into agents

  async prompt(existing) {
    console.log("\n--- VPS SSH Key ---");
    console.log("SSH keypair used to connect to VPS instances.\n");

    // If both fields exist, offer to reuse
    if (existing?.private_key && existing?.public_key) {
      const preview = existing.public_key.slice(0, 40) + "...";
      const reuse = await confirm({
        message: `Found existing VPS SSH key (${preview}). Keep it?`,
        default: true,
      });
      if (reuse) return { values: existing };
    }

    const method = await select({
      message: "SSH key source:",
      choices: [
        { name: "Generate a new ed25519 keypair", value: "generate" as const },
        { name: "Import from file (e.g. ~/.ssh/id_rsa)", value: "file" as const },
        { name: "Paste key directly", value: "paste" as const },
      ],
    });

    let privateKey: string;
    let publicKey: string;

    if (method === "generate") {
      const tmpDir = mkdtempSync(resolve(tmpdir(), "al-keygen-"));
      const keyPath = resolve(tmpDir, "id_ed25519");
      try {
        execSync(`ssh-keygen -t ed25519 -f ${keyPath} -N "" -C "action-llama"`, {
          stdio: "pipe",
        });
        privateKey = readFileSync(keyPath, "utf-8");
        publicKey = readFileSync(`${keyPath}.pub`, "utf-8").trim();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
      console.log("Generated new ed25519 keypair.");
    } else if (method === "file") {
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
      privateKey = readFileSync(resolvedPath, "utf-8");

      // Try to read the matching .pub file
      const pubPath = resolvedPath + ".pub";
      if (existsSync(pubPath)) {
        publicKey = readFileSync(pubPath, "utf-8").trim();
      } else {
        // Derive public key from private key
        try {
          publicKey = execSync(`ssh-keygen -y -f ${resolvedPath}`, { stdio: "pipe" }).toString().trim();
        } catch {
          throw new Error(`Could not read or derive public key. Place it at ${pubPath} or ensure ssh-keygen is available.`);
        }
      }
    } else {
      privateKey = await password({
        message: "Paste your SSH private key (entire content, then press Enter):",
        mask: "*",
        validate: (v: string) => {
          const trimmed = v.trim();
          if (!trimmed) return "Key is required";
          if (!trimmed.includes("PRIVATE KEY")) return "Does not look like a private key — expected a PEM-formatted key";
          return true;
        },
      });
      privateKey = privateKey.trim();

      // Try to derive public key
      const tmpDir = mkdtempSync(resolve(tmpdir(), "al-keygen-"));
      const tmpKeyPath = resolve(tmpDir, "key");
      try {
        const { writeFileSync, chmodSync } = await import("fs");
        writeFileSync(tmpKeyPath, privateKey + "\n", { mode: 0o600 });
        publicKey = execSync(`ssh-keygen -y -f ${tmpKeyPath}`, { stdio: "pipe" }).toString().trim();
      } catch {
        // Fall back to asking
        publicKey = await input({
          message: "Could not derive public key. Paste it:",
          validate: (v) => (v.trim().length > 0 ? true : "Public key is required"),
        });
        publicKey = publicKey.trim();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    console.log(`\nVPS SSH key configured.\n`);
    return { values: { private_key: privateKey, public_key: publicKey } };
  },
};

export default vpsSsh;
