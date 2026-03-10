/**
 * Build a container image for the cloud scheduler.
 *
 * The scheduler image contains:
 * - The AL CLI (npm package dist + node_modules)
 * - Project config.toml
 * - All agent directories (agent-config.toml, ACTIONS.md, prompt files, Dockerfiles)
 *
 * Entrypoint: `node dist/cli/main.js start -p /app/project -c --headless --gateway`
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve as resolvePath, dirname, relative, join } from "path";
import { fileURLToPath } from "url";
import type { GlobalConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import type { Logger } from "../shared/logger.js";

const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SchedulerImageOpts {
  projectPath: string;
  globalConfig: GlobalConfig;
  runtime: ContainerRuntime;
  logger: Logger;
  onProgress?: (msg: string) => void;
}

/**
 * Collect all project files that should be baked into the scheduler image.
 *
 * Returns a Record of relative path (inside /app/project/) → file contents.
 */
function collectProjectFiles(projectPath: string): Record<string, string> {
  const files: Record<string, string> = {};

  // config.toml
  const configPath = resolvePath(projectPath, "config.toml");
  if (existsSync(configPath)) {
    files["config.toml"] = readFileSync(configPath, "utf-8");
  }

  // Walk agent directories
  for (const entry of readdirSync(projectPath)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const entryPath = resolvePath(projectPath, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    // Only include directories that have agent-config.toml
    const agentConfigPath = resolvePath(entryPath, "agent-config.toml");
    if (!existsSync(agentConfigPath)) continue;

    // Collect all files in the agent directory (non-recursive for now)
    for (const file of readdirSync(entryPath)) {
      const filePath = resolvePath(entryPath, file);
      if (!statSync(filePath).isFile()) continue;
      files[join(entry, file)] = readFileSync(filePath, "utf-8");
    }
  }

  return files;
}

/**
 * Generate the scheduler Dockerfile content.
 */
function generateDockerfile(): string {
  return [
    "FROM public.ecr.aws/docker/library/node:20-slim",
    "",
    "RUN apt-get update && apt-get install -y --no-install-recommends \\",
    "    git curl ca-certificates openssh-client \\",
    "    && rm -rf /var/lib/apt/lists/*",
    "",
    "WORKDIR /app",
    "COPY package.json ./",
    "RUN npm install --production",
    "COPY dist/ ./dist/",
    "",
    "# Baked-in project files",
    "COPY project/ ./project/",
    "",
    "EXPOSE 8080",
    "",
    'ENTRYPOINT ["node", "dist/cli/main.js", "start", \\',
    '  "-p", "/app/project", "-c", "--headless", "--gateway"]',
    "",
  ].join("\n");
}

/**
 * Build and push the scheduler container image.
 *
 * Returns the remote image URI (e.g. ECR or Artifact Registry URI).
 */
export async function buildSchedulerImage(opts: SchedulerImageOpts): Promise<string> {
  const { projectPath, runtime, logger, onProgress } = opts;

  logger.info("Building scheduler image...");
  onProgress?.("Building scheduler image");

  const projectFiles = collectProjectFiles(projectPath);
  const dockerfileContent = generateDockerfile();

  // The extraFiles map puts project files under the "project/" prefix so that
  // COPY project/ ./project/ in the Dockerfile picks them up.
  const extraFiles: Record<string, string> = {};
  for (const [relPath, content] of Object.entries(projectFiles)) {
    extraFiles[join("project", relPath)] = content;
  }

  const tag = AWS_CONSTANTS.SCHEDULER_IMAGE;

  const image = await runtime.buildImage({
    tag,
    dockerfile: "Dockerfile",
    contextDir: packageRoot,
    dockerfileContent,
    extraFiles,
    onProgress,
  });

  // Push to remote registry
  onProgress?.("Pushing scheduler image");
  const remoteImage = await runtime.pushImage(image);
  logger.info({ image: remoteImage }, "Scheduler image pushed");

  return remoteImage;
}
