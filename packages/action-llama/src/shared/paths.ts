import { resolve } from "path";
import { homedir } from "os";

export const AL_HOME = resolve(homedir(), ".al");
export const AL_HOME_DIR = resolve(homedir(), ".action-llama");
export const CREDENTIALS_DIR = resolve(AL_HOME_DIR, "credentials");
export const STATE_DIR = resolve(AL_HOME_DIR, "state");
export const ENVIRONMENTS_DIR = resolve(AL_HOME_DIR, "environments");

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
  return resolve(projectPath, "agents", agentType);
}

export function statsDbPath(projectPath: string): string {
  return resolve(projectPath, ".al", "stats.db");
}

/** Path to the consolidated action-llama database. */
export function dbPath(projectPath: string): string {
  return resolve(projectPath, ".al", "action-llama.db");
}

/** @deprecated Use dbPath() instead. */
export function stateDbPath(projectPath: string): string {
  return resolve(projectPath, ".al", "state.db");
}

/** @deprecated Use dbPath() instead. */
export function workQueueDbPath(projectPath: string): string {
  return resolve(projectPath, ".al", "work-queue.db");
}
