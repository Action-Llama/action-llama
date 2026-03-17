/**
 * `al cloud deploy` — Build and deploy the scheduler + agents to the cloud.
 *
 * Steps:
 * 1. Validate config (must have [cloud] section)
 * 2. Run doctor -c to ensure creds are pushed + IAM is set up
 * 3. Create cloud runtime + build all agent images
 * 4. Build scheduler image
 * 5. Deploy scheduler service (App Runner or Cloud Run)
 * 6. Print deployed URL
 */

import { resolve } from "path";
import { loadGlobalConfig, discoverAgents, loadAgentConfig, validateAgentConfig } from "../../shared/config.js";
import { execute as runDoctor } from "./doctor.js";
import { buildAllImages } from "../../cloud/image-builder.js";
import { buildSchedulerImage } from "../../cloud/scheduler-image.js";
import { createLogger } from "../../shared/logger.js";
import { createCloudProvider } from "../../cloud/provider.js";

export async function execute(opts: { project: string; env?: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const globalConfig = loadGlobalConfig(projectPath, opts.env);
  const cloud = globalConfig.cloud;

  if (!cloud) {
    throw new Error("No cloud config found. Set up an environment with 'al env init <name> --type ecs' (or --type cloud-run).");
  }

  const provider = await createCloudProvider(cloud);
  const logger = createLogger(projectPath, "deploy");

  console.log(`\n=== Cloud Deploy (${cloud.provider}) ===\n`);

  // 1. Run doctor -c to push credentials and reconcile IAM
  console.log("Step 1: Validating credentials and IAM...");
  await runDoctor({ project: opts.project, env: opts.env, checkOnly: true });
  console.log("");

  // 2. Set up cloud credential backend
  const { setDefaultBackend } = await import("../../shared/credentials.js");
  const backend = await provider.createCredentialBackend();
  setDefaultBackend(backend);

  // 3. Discover agents and create runtime
  const agentNames = discoverAgents(projectPath);
  if (agentNames.length === 0) {
    throw new Error("No agents found. Create agents first.");
  }

  const agentConfigs = agentNames.map((name) => loadAgentConfig(projectPath, name));
  for (const config of agentConfigs) {
    validateAgentConfig(config);
  }
  const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);

  const runtime = provider.createRuntime();

  // 4. Build agent images
  console.log("Step 2: Building agent images...");
  const lastProgress = new Map<string, string>();
  await buildAllImages({
    projectPath,
    globalConfig,
    activeAgentConfigs,
    runtime,
    runtimeType: cloud.provider,
    logger,
    skills: { locking: true },
    onProgress: (label, msg) => {
      if (lastProgress.get(label) !== msg) {
        lastProgress.set(label, msg);
        console.log(`  [${label}] ${msg}`);
      }
    },
  });
  console.log("Agent images built and pushed.\n");

  // 5. Build scheduler image
  console.log("Step 3: Building scheduler image...");
  const schedulerImageUri = await buildSchedulerImage({
    projectPath,
    globalConfig,
    runtime,
    logger,
    onProgress: (msg) => console.log(`  ${msg}`),
  });
  console.log(`Scheduler image: ${schedulerImageUri}\n`);

  // 6. Deploy scheduler service
  console.log("Step 4: Deploying scheduler service...");
  const serviceInfo = await provider.deployScheduler(schedulerImageUri);

  console.log(`\nScheduler deployed successfully!`);
  console.log(`  URL:    ${serviceInfo.serviceUrl}`);
  console.log(`  Status: ${serviceInfo.status}`);

  // Print webhook URLs
  const webhookSources = globalConfig.webhooks ?? {};
  const providerTypes = new Set(
    agentConfigs.flatMap((a) =>
      a.webhooks?.map((t) => webhookSources[t.source]?.type).filter(Boolean) || []
    )
  );

  if (providerTypes.size > 0) {
    console.log("\nWebhook endpoints:");
    for (const pt of providerTypes) {
      console.log(`  ${pt}: ${serviceInfo.serviceUrl}/webhooks/${pt}`);
    }
  }

  console.log("");
}
