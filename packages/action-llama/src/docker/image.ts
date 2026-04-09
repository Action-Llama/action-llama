/**
 * Image building utilities for the transport runner.
 *
 * Provides functions to build project-level and agent-specific Docker images
 * from Dockerfiles in the project directory. The transport runner calls these
 * before provisioning containers so that agent code, system packages, and
 * other customizations from Dockerfiles are available at runtime.
 */

import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { LocalDockerRuntime } from "./local-runtime.js";
import { CONSTANTS } from "../shared/constants.js";

/**
 * Check if a Docker image exists locally.
 */
export function imageExists(image: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", image], {
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a Dockerfile has real customization beyond a bare FROM line.
 * Returns true if there are instructions beyond FROM (RUN, COPY, etc.).
 */
export function isProjectDockerfileCustomized(content: string): boolean {
  const instructions = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  // A customized Dockerfile has more than just a FROM line
  return instructions.length > 1;
}

/**
 * Build the project base image from <projectPath>/Dockerfile if it's customized.
 * Returns the image tag to use (either the built project base image or the
 * original baseImage if no customization is needed).
 */
export async function ensureProjectBaseImage(
  projectPath: string,
  baseImage: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const dockerfilePath = join(projectPath, "Dockerfile");
  if (!existsSync(dockerfilePath)) {
    return baseImage;
  }

  const content = readFileSync(dockerfilePath, "utf-8");
  if (!isProjectDockerfileCustomized(content)) {
    return baseImage;
  }

  const tag = CONSTANTS.PROJECT_BASE_IMAGE;

  // Skip build if image already exists with the correct tag (same git SHA)
  if (imageExists(tag)) {
    onProgress?.(`Project base image already built: ${tag}`);
    return tag;
  }

  onProgress?.("Building project base image...");

  const runtime = new LocalDockerRuntime();
  await runtime.buildImage({
    tag,
    dockerfile: "Dockerfile",
    contextDir: projectPath,
    baseImage,
    onProgress,
  });

  return tag;
}

/**
 * Build an agent-specific image from <projectPath>/agents/<name>/Dockerfile.
 * The agent image extends the provided baseImage (which may be the project
 * base image or the default base image).
 *
 * Returns the image tag to use (either the built agent image or the
 * baseImage if no agent Dockerfile exists).
 */
export async function ensureAgentImage(
  agentName: string,
  projectPath: string,
  baseImage: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const agentDir = join(projectPath, "agents", agentName);
  const dockerfilePath = join(agentDir, "Dockerfile");
  if (!existsSync(dockerfilePath)) {
    return baseImage;
  }

  const tag = CONSTANTS.agentImage(agentName);

  // Skip build if image already exists with the correct tag (same git SHA)
  if (imageExists(tag)) {
    onProgress?.(`Agent image already built: ${tag}`);
    return tag;
  }

  onProgress?.(`Building ${agentName} agent image...`);

  const runtime = new LocalDockerRuntime();
  await runtime.buildImage({
    tag,
    dockerfile: "Dockerfile",
    contextDir: agentDir,
    baseImage,
    onProgress,
  });

  return tag;
}
