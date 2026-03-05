import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..", "..");

const DEFAULT_IMAGE = "al-agent:latest";

function docker(args: string[], opts?: { quiet?: boolean; cwd?: string }): string {
  return execFileSync("docker", args, {
    encoding: "utf-8",
    stdio: opts?.quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
    timeout: 300000, // 5 min for builds
    cwd: opts?.cwd || PACKAGE_ROOT,
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
 * Resolve the Docker image for an agent.
 *
 * If the agent directory contains a Dockerfile, build an agent-specific image
 * that extends the base image (the agent Dockerfile should `FROM al-agent:latest`).
 * Otherwise, return the base image name.
 */
export function ensureAgentImage(agentName: string, projectPath: string, baseImage: string = DEFAULT_IMAGE): string {
  const agentDockerfile = resolve(projectPath, agentName, "Dockerfile");
  if (!existsSync(agentDockerfile)) {
    return baseImage;
  }

  const agentImage = `al-${agentName}:latest`;

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
