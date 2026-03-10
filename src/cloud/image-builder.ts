/**
 * Shared image build logic used by both `al start` (scheduler) and `al cloud deploy`.
 *
 * Extracted from src/scheduler/index.ts to avoid duplicating the base-image +
 * per-agent image build pipeline.
 */

import { existsSync, readFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";
import type { AgentConfig, GlobalConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import { buildPromptSkeleton, type PromptSkills } from "../agents/prompt.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";

/** Resolve to the package root (two levels up from src/cloud/) */
const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ImageBuildOpts {
  projectPath: string;
  globalConfig: GlobalConfig;
  activeAgentConfigs: AgentConfig[];
  runtime: ContainerRuntime;
  /** "local" | "cloud-run" | "ecs" */
  runtimeType: string;
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
 * Build the base image, per-agent images, and push to remote registry.
 *
 * Returns the resolved base image URI and a map of agent name → image URI.
 */
export async function buildAllImages(opts: ImageBuildOpts): Promise<ImageBuildResult> {
  const { projectPath, globalConfig, activeAgentConfigs, runtime, runtimeType, statusTracker, logger, skills, onProgress } = opts;

  // 1. Build base image
  let baseImage = globalConfig.local?.image || AWS_CONSTANTS.DEFAULT_IMAGE;
  logger.info({ image: baseImage }, "Building base image (this may take a few minutes on first run)...");

  const setBaseImageProgress = (msg: string) => {
    statusTracker?.setBaseImageStatus(msg);
    onProgress?.("base", msg);
  };

  if (runtimeType === "local") {
    const { imageExists } = await import("../docker/image.js");
    if (!imageExists(baseImage)) {
      setBaseImageProgress("Building");
      await runtime.buildImage({
        tag: baseImage, dockerfile: "docker/Dockerfile", contextDir: packageRoot,
        onProgress: setBaseImageProgress,
      });
    }
  } else {
    baseImage = await runtime.buildImage({
      tag: baseImage, dockerfile: "docker/Dockerfile", contextDir: packageRoot,
      onProgress: setBaseImageProgress,
    });
  }

  statusTracker?.setBaseImageStatus(null);

  // 2. Build per-agent images in parallel
  const agentImages: Record<string, string> = {};

  await Promise.all(activeAgentConfigs.map(async (agentConfig) => {
    statusTracker?.setAgentState(agentConfig.name, "building");
    statusTracker?.setAgentStatusText(agentConfig.name, "Building agent image");
    onProgress?.(agentConfig.name, "Building agent image");

    const hasCustomDockerfile = existsSync(resolvePath(projectPath, agentConfig.name, "Dockerfile"));

    const actionsPath = resolvePath(projectPath, agentConfig.name, "ACTIONS.md");
    const actionsMd = existsSync(actionsPath) ? readFileSync(actionsPath, "utf-8") : "";
    const timeout = String(agentConfig.timeout ?? globalConfig.local?.timeout ?? 900);

    const extraFiles: Record<string, string> = {
      "agent-config.json": JSON.stringify(agentConfig),
      "ACTIONS.md": actionsMd,
      "prompt-static.txt": buildPromptSkeleton(agentConfig, skills),
      "timeout": timeout,
    };

    const agentImageTag = AWS_CONSTANTS.agentImage(agentConfig.name);

    let image: string;
    if (hasCustomDockerfile) {
      image = await runtime.buildImage({
        tag: agentImageTag,
        dockerfile: resolvePath(projectPath, agentConfig.name, "Dockerfile"),
        contextDir: packageRoot,
        baseImage,
        extraFiles,
        onProgress: (msg) => { statusTracker?.setAgentStatusText(agentConfig.name, msg); onProgress?.(agentConfig.name, msg); },
      });
    } else {
      image = await runtime.buildImage({
        tag: agentImageTag,
        dockerfile: "Dockerfile",
        contextDir: packageRoot,
        dockerfileContent: `FROM ${baseImage}\nCOPY static/ /app/static/\n`,
        extraFiles,
        onProgress: (msg) => { statusTracker?.setAgentStatusText(agentConfig.name, msg); onProgress?.(agentConfig.name, msg); },
      });
    }
    agentImages[agentConfig.name] = image;
    logger.info({ agent: agentConfig.name, image }, "Built agent image");
  }));

  // 3. Push images to remote registry (no-op for local)
  if (runtimeType !== "local") {
    const imagesToPush = activeAgentConfigs.filter(ac => {
      const currentImage = agentImages[ac.name] || baseImage;
      return !currentImage.includes("/");
    });

    if (imagesToPush.length > 0) {
      await Promise.all(imagesToPush.map(async (agentConfig, idx) => {
        const currentImage = agentImages[agentConfig.name] || baseImage;
        const progressIndicator = imagesToPush.length > 1 ? ` (${idx + 1}/${imagesToPush.length})` : "";
        statusTracker?.setAgentStatusText(agentConfig.name, `Pushing image to registry${progressIndicator}`);
        onProgress?.(agentConfig.name, `Pushing image to registry${progressIndicator}`);
        const remoteImage = await runtime.pushImage(currentImage);
        agentImages[agentConfig.name] = remoteImage;
        logger.info({ agent: agentConfig.name, image: remoteImage, progress: `${idx + 1}/${imagesToPush.length}` }, "Pushed image to registry");
      }));
    }
  }

  // Reset all agents back to idle after builds complete
  for (const ac of activeAgentConfigs) {
    statusTracker?.setAgentState(ac.name, "idle");
  }

  logger.info("Docker infrastructure ready");

  return { baseImage, agentImages };
}
