/**
 * Shared image build logic for `al start` (scheduler).
 *
 * Builds the base Docker image and per-agent images for local Docker execution.
 */

import { existsSync, readFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";
import type { AgentConfig, GlobalConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import { CONSTANTS, imageTags } from "../shared/constants.js";
import { buildPromptSkeleton, type PromptSkills } from "../agents/prompt.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";

/** Resolve to the package root (two levels up from src/scheduler/) */
const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ImageBuildOpts {
  projectPath: string;
  globalConfig: GlobalConfig;
  activeAgentConfigs: AgentConfig[];
  runtime: ContainerRuntime;
  statusTracker?: StatusTracker;
  logger: Logger;
  skills?: PromptSkills;
  /** Optional progress callback for headless/CLI output (label, message) */
  onProgress?: (label: string, message: string) => void;
}

export interface ImageBuildResult {
  baseImage: string;
  agentImages: Record<string, string>;
}

/**
 * Check whether the project Dockerfile has user customizations beyond a bare FROM.
 */
function isProjectDockerfileCustomized(projectPath: string): boolean {
  const dockerfilePath = resolvePath(projectPath, "Dockerfile");
  if (!existsSync(dockerfilePath)) return false;

  const instructions = readFileSync(dockerfilePath, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  // Unmodified = empty or a single FROM line
  if (instructions.length <= 1) return false;
  return true;
}

/**
 * Build the base image and per-agent images.
 *
 * Returns the resolved base image tag and a map of agent name → image tag.
 */
export async function buildAllImages(opts: ImageBuildOpts): Promise<ImageBuildResult> {
  const { projectPath, globalConfig, activeAgentConfigs, runtime, statusTracker, logger, skills, onProgress } = opts;

  // 1. Build base image
  let baseImage = globalConfig.local?.image || CONSTANTS.DEFAULT_IMAGE;
  logger.info({ image: baseImage }, "Building base image (this may take a few minutes on first run)...");

  const setBaseImageProgress = (msg: string) => {
    statusTracker?.setBaseImageStatus(msg);
    onProgress?.("base", msg);
  };

  const { imageExists } = await import("../docker/image.js");
  if (!imageExists(baseImage)) {
    setBaseImageProgress("Building");
    const [, ...baseAliases] = imageTags("al-agent");
    await runtime.buildImage({
      tag: baseImage, dockerfile: "docker/Dockerfile", contextDir: packageRoot,
      onProgress: setBaseImageProgress,
      additionalTags: baseAliases,
      useLockfileHash: true,
    });
  }

  statusTracker?.setBaseImageStatus(null);

  // 1.5. Build project base image (if project has a customized Dockerfile)
  let effectiveBaseImage = baseImage;
  const projectDockerfile = resolvePath(projectPath, "Dockerfile");

  if (isProjectDockerfileCustomized(projectPath)) {
    const projectBaseTag = CONSTANTS.PROJECT_BASE_IMAGE;
    logger.info("Building project base image...");
    const setProjectBaseProgress = (msg: string) => {
      statusTracker?.setBaseImageStatus(msg);
      onProgress?.("project-base", msg);
    };

    const [, ...projAliases] = imageTags("al-project-base");
    setProjectBaseProgress("Building project base image");
    effectiveBaseImage = await runtime.buildImage({
      tag: projectBaseTag,
      dockerfile: projectDockerfile,
      contextDir: packageRoot,
      baseImage,
      onProgress: setProjectBaseProgress,
      additionalTags: projAliases,
    });

    statusTracker?.setBaseImageStatus(null);
    logger.info({ image: effectiveBaseImage }, "Project base image built");
  }

  // 2. Build per-agent images
  const agentImages: Record<string, string> = {};

  const agentMeta = activeAgentConfigs.map((agentConfig) => {
    const agentPath = resolvePath(projectPath, "agents", agentConfig.name);
    const hasCustomDockerfile = existsSync(resolvePath(agentPath, "Dockerfile"));
    const actionsPath = resolvePath(agentPath, "ACTIONS.md");
    const actionsMd = existsSync(actionsPath) ? readFileSync(actionsPath, "utf-8") : "";
    const timeout = String(agentConfig.timeout ?? globalConfig.local?.timeout ?? 900);
    const extraFiles: Record<string, string> = {
      "agent-config.json": JSON.stringify(agentConfig),
      "ACTIONS.md": actionsMd,
      "prompt-static.txt": buildPromptSkeleton(agentConfig, skills),
      "timeout": timeout,
    };
    const testScriptPath = resolvePath(agentPath, "test-script.sh");
    if (existsSync(testScriptPath)) {
      extraFiles["test-script.sh"] = readFileSync(testScriptPath, "utf-8");
    }
    return { agentConfig, hasCustomDockerfile, extraFiles };
  });

  for (const a of agentMeta) {
    statusTracker?.setAgentState(a.agentConfig.name, "building");
    statusTracker?.setAgentStatusText(a.agentConfig.name, "Building agent image");
    onProgress?.(a.agentConfig.name, "Building agent image");
  }

  const buildPromises = agentMeta.map(async ({ agentConfig, hasCustomDockerfile, extraFiles }) => {
    const agentImageTag = CONSTANTS.agentImage(agentConfig.name);
    const [, ...agentAliases] = imageTags(`al-${agentConfig.name}`);
    const progressCb = (msg: string) => { statusTracker?.setAgentStatusText(agentConfig.name, msg); onProgress?.(agentConfig.name, msg); };

    const image = await runtime.buildImage({
      tag: agentImageTag,
      dockerfile: hasCustomDockerfile
        ? resolvePath(projectPath, "agents", agentConfig.name, "Dockerfile")
        : "Dockerfile",
      contextDir: packageRoot,
      dockerfileContent: hasCustomDockerfile ? undefined : `FROM ${effectiveBaseImage}\n`,
      baseImage: hasCustomDockerfile ? effectiveBaseImage : undefined,
      extraFiles,
      onProgress: progressCb,
      additionalTags: agentAliases,
    });
    agentImages[agentConfig.name] = image;
    logger.info({ agent: agentConfig.name, image }, "Built agent image");
  });

  await Promise.all(buildPromises);

  // Reset all agents back to idle after builds complete
  for (const ac of activeAgentConfigs) {
    statusTracker?.setAgentState(ac.name, "idle");
  }

  logger.info("Docker infrastructure ready");

  return { baseImage: effectiveBaseImage, agentImages };
}
