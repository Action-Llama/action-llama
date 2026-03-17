import { resolve } from "path";
import { gatewayFetch } from "../gateway-client.js";
import { loadGlobalConfig } from "../../shared/config.js";
import type { RunningAgent } from "../../docker/runtime.js";

export async function execute(target: string, opts: { project: string; cloud?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  if (opts.cloud) {
    await executeCloud(target, projectPath);
    return;
  }

  await executeLocal(target, projectPath);
}

async function executeCloud(target: string, projectPath: string): Promise<void> {
  const globalConfig = loadGlobalConfig(projectPath);
  const cloud = globalConfig.cloud;
  if (!cloud) {
    throw new Error("No [cloud] section found in config.toml. Run 'al setup cloud' first.");
  }

  const { createCloudProvider } = await import("../../cloud/provider.js");
  const provider = await createCloudProvider(cloud);
  const runtime = provider.createRuntime();
  const running: RunningAgent[] = await runtime.listRunningAgents();

  // Match by agent name (kill all instances) or by taskId (kill specific instance)
  const byName = running.filter((a) => a.agentName === target);
  const byTaskId = running.filter((a) => a.taskId === target);

  const matches = byName.length > 0 ? byName : byTaskId;

  if (matches.length === 0) {
    throw new Error(`No running cloud instances found matching "${target}".`);
  }

  for (const match of matches) {
    await runtime.kill(match.runtimeId);
  }

  const label = byName.length > 0
    ? `Killed ${matches.length} instance(s) of agent "${target}".`
    : `Killed instance ${target}.`;
  console.log(label);
}

async function executeLocal(target: string, projectPath: string): Promise<void> {
  const fetchOpts = {
    project: projectPath,
    method: "POST",
  };

  let response: Response;
  try {
    // Try as agent name first (kills all instances of that agent)
    response = await gatewayFetch({
      ...fetchOpts,
      path: `/control/agents/${encodeURIComponent(target)}/kill`,
    });

    // If agent not found, fall back to instance ID
    if (response.status === 404) {
      response = await gatewayFetch({
        ...fetchOpts,
        path: `/control/kill/${encodeURIComponent(target)}`,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      throw new Error("Scheduler not running. Start it with 'al start'.");
    }
    throw error;
  }

  const data = await response.json();

  if (response.ok) {
    console.log(`${data.message}`);
  } else {
    throw new Error(data.error);
  }
}
