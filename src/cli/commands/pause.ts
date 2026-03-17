import { resolve } from "path";
import { gatewayFetch } from "../gateway-client.js";
import { loadGlobalConfig } from "../../shared/config.js";
import { cloudGatewayFetch } from "../cloud-gateway-client.js";

export async function execute(name: string | undefined, opts: { project: string; cloud?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);
  const path = name
    ? `/control/agents/${encodeURIComponent(name)}/pause`
    : "/control/pause";

  if (opts.cloud) {
    await executeCloud(path, projectPath);
    return;
  }

  await executeLocal(path, projectPath);
}

async function executeCloud(path: string, projectPath: string): Promise<void> {
  const globalConfig = loadGlobalConfig(projectPath);
  const cloud = globalConfig.cloud;
  if (!cloud) {
    throw new Error("No [cloud] section found in config.toml. Run 'al setup cloud' first.");
  }

  const { createCloudProvider } = await import("../../cloud/provider.js");
  const provider = await createCloudProvider(cloud);
  const status = await provider.getSchedulerStatus();
  if (!status) {
    throw new Error("Cloud scheduler is not deployed. Run 'al cloud deploy' first.");
  }

  const { ok, data } = await cloudGatewayFetch(status.serviceUrl, {
    project: projectPath,
    path,
    method: "POST",
  });

  if (ok) {
    console.log(`${data.message}`);
  } else {
    throw new Error(data.error as string);
  }
}

async function executeLocal(path: string, projectPath: string): Promise<void> {
  let response: Response;
  try {
    response = await gatewayFetch({
      project: projectPath,
      path,
      method: "POST",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      throw new Error("Gateway not running. Start the scheduler with --gateway (-g) flag.");
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
