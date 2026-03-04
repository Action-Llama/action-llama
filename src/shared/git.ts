import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "./paths.js";

const SSH_KEY_PATH = resolve(CREDENTIALS_DIR, "id_rsa");

export function sshUrl(owner: string, repo: string): string {
  return `git@github.com:${owner}/${repo}.git`;
}

function gitSshEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (existsSync(SSH_KEY_PATH)) {
    env.GIT_SSH_COMMAND = `ssh -i "${SSH_KEY_PATH}" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;
  }
  return env;
}

export function gitExec(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    timeout: 120000,
    env: gitSshEnv(),
  }).trim();
}
