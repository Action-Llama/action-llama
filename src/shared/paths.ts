import { resolve } from "path";
import { homedir } from "os";

export const AL_HOME = resolve(homedir(), ".al");
export const CREDENTIALS_DIR = resolve(homedir(), ".action-llama-credentials");

export function projectDir(projectPath: string): string {
  return resolve(projectPath);
}

export function logsDir(projectPath: string): string {
  return resolve(projectPath, ".al", "logs");
}

export function eventsDir(projectPath: string): string {
  return resolve(projectPath, ".al", "events");
}

export function agentDir(projectPath: string, agentType: string): string {
  return resolve(projectPath, agentType);
}
