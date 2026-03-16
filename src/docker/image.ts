import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..", "..");

import { CONSTANTS } from "../shared/constants.js";

const DEFAULT_IMAGE = CONSTANTS.DEFAULT_IMAGE;

function docker(args: string[], opts?: { quiet?: boolean; cwd?: string }): string {
  return execFileSync("docker", args, {
    encoding: "utf-8",
    stdio: opts?.quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
    timeout: 300000, // 5 min for builds
    cwd: opts?.cwd || PACKAGE_ROOT,
    env: { ...process.env, DOCKER_BUILDKIT: "1" },
  }).trim();
}

export function imageExists(image: string = DEFAULT_IMAGE): boolean {
  try {
    docker(["image", "inspect", image], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export function buildImage(image: string = DEFAULT_IMAGE): void {
  docker([
    "build",
    "-t", image,
    "-f", "docker/Dockerfile",
    ".",
  ]);
}

export function ensureImage(image: string = DEFAULT_IMAGE): void {
  if (!imageExists(image)) {
    buildImage(image);
  }
}

/**
 * Build the project base image if the project has a customized Dockerfile.
 *
 * Returns the effective base image tag — either the project base image
 * if customizations exist, or the original baseImage if not.
 */
export function ensureProjectBaseImage(projectPath: string, baseImage: string = DEFAULT_IMAGE): string {
  const projectDockerfile = resolve(projectPath, "Dockerfile");
  if (!existsSync(projectDockerfile)) return baseImage;

  const instructions = readFileSync(projectDockerfile, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  // Unmodified = empty or a single FROM line — skip the extra build
  if (instructions.length <= 1) return baseImage;

  const projectBaseImage = CONSTANTS.PROJECT_BASE_IMAGE;

  // Always rebuild — the project Dockerfile may have changed
  docker([
    "build",
    "-t", projectBaseImage,
    "-f", projectDockerfile,
    ".",
  ], { cwd: PACKAGE_ROOT });

  return projectBaseImage;
}

/**
 * Resolve the Docker image for an agent.
 *
 * If the agent directory contains a Dockerfile, build an agent-specific image
 * that extends the base image (the agent Dockerfile should `FROM al-agent:latest`).
 * Otherwise, return the base image name.
 */
export function ensureAgentImage(agentName: string, projectPath: string, baseImage: string = DEFAULT_IMAGE): string {
  const agentDockerfile = resolve(projectPath, "agents", agentName, "Dockerfile");
  if (!existsSync(agentDockerfile)) {
    return baseImage;
  }

  const agentImage = CONSTANTS.agentImage(agentName);

  // Always rebuild agent images — they're thin layers on top of the base
  // and the Dockerfile may have changed since last build
  docker([
    "build",
    "-t", agentImage,
    "-f", agentDockerfile,
    ".",
  ], { cwd: PACKAGE_ROOT });

  return agentImage;
}
