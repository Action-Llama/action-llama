/**
 * Cloud provisioning state persistence.
 * Stores provisioned resource information at ~/.action-llama/state/<project-hash>.json.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { resolve } from "path";
import { STATE_DIR } from "../shared/paths.js";
import type { ProvisionedResource } from "./provider.js";

export interface ProvisionedState {
  projectPath: string;
  provider: "ecs" | "cloud-run" | "vps";
  createdAt: string;
  updatedAt: string;
  resources: ProvisionedResource[];
}

function projectHash(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

function stateFilePath(projectPath: string): string {
  return resolve(STATE_DIR, `${projectHash(projectPath)}.json`);
}

export function loadState(projectPath: string): ProvisionedState | null {
  const filePath = stateFilePath(projectPath);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ProvisionedState;
  } catch {
    return null;
  }
}

export function saveState(state: ProvisionedState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const filePath = stateFilePath(state.projectPath);
  state.updatedAt = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function deleteState(projectPath: string): void {
  const filePath = stateFilePath(projectPath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function createState(
  projectPath: string,
  provider: "ecs" | "cloud-run" | "vps",
  resources: ProvisionedResource[],
): ProvisionedState {
  const now = new Date().toISOString();
  return {
    projectPath,
    provider,
    createdAt: now,
    updatedAt: now,
    resources,
  };
}
