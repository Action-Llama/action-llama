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

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { resolve as resolvePath, dirname, join } from "path";
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
    "# Project files are baked in via extraFiles → static/project/",
    "# (the build pipeline auto-injects COPY static/ /app/static/)",
    "",
    "EXPOSE 8080",
    "",
    'ENTRYPOINT ["node", "dist/cli/main.js", "start", \\',
    '  "-p", "/app/static/project", "-c", "--headless", "--gateway"]',
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

  // The extraFiles map puts project files under the "project/" prefix.
  // The build pipeline writes them to static/project/ and auto-injects
  // COPY static/ /app/static/.
  const extraFiles: Record<string, string> = {};
  for (const [relPath, content] of Object.entries(projectFiles)) {
    extraFiles[join("project", relPath)] = content;
  }

  // Write the Dockerfile to a temp file rather than using dockerfileContent,
  // so that buildImageCodeBuild includes package.json + dist/ in the content
  // hash and build context. This ensures AL code changes bust the cache.
  const { tmpdir } = await import("os");
  const { randomUUID } = await import("crypto");
  const tmpDockerfile = join(tmpdir(), `al-scheduler-dockerfile-${randomUUID().slice(0, 8)}`);
  mkdirSync(dirname(tmpDockerfile), { recursive: true });
  writeFileSync(tmpDockerfile, dockerfileContent);

  const tag = AWS_CONSTANTS.SCHEDULER_IMAGE;

  const image = await runtime.buildImage({
    tag,
    dockerfile: tmpDockerfile,
    contextDir: packageRoot,
    extraFiles,
    onProgress,
  });

  // Push to remote registry
  onProgress?.("Pushing scheduler image");
  const remoteImage = await runtime.pushImage(image);
  logger.info({ image: remoteImage }, "Scheduler image pushed");

  return remoteImage;
}
