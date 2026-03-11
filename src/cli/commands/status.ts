import { resolve } from "path";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import type { RunningAgent } from "../../docker/runtime.js";

export async function execute(opts: { project: string; cloud?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  if (opts.cloud) {
    const globalConfig = loadGlobalConfig(projectPath);
    const cloud = globalConfig.cloud;
    if (!cloud) {
      throw new Error("No [cloud] section found in config.toml. Run 'al cloud setup' first.");
    }

    let agents: RunningAgent[];

    // Show scheduler service status
    if (cloud.provider === "cloud-run") {
      const { getCloudRunStatus } = await import("../../cloud/deploy-cloudrun.js");
      const svc = await getCloudRunStatus(cloud);
      if (svc) {
        console.log("Scheduler (Cloud Run service):");
        console.log(`  URL:    ${svc.serviceUrl}`);
        console.log(`  Status: ${svc.status}`);
      } else {
        console.log("Scheduler: not deployed");
      }
      console.log("");

      const { CloudRunJobRuntime } = await import("../../docker/cloud-run-runtime.js");
      const runtime = new CloudRunJobRuntime(cloud as any);
      console.log(`Cloud Run Jobs status (project: ${cloud.gcpProject}):\n`);
      agents = await runtime.listRunningAgents();
    } else {
      const { getAppRunnerStatus } = await import("../../cloud/deploy-apprunner.js");
      const svc = await getAppRunnerStatus(cloud);
      if (svc) {
        console.log("Scheduler (App Runner):");
        console.log(`  URL:    ${svc.serviceUrl}`);
        console.log(`  Status: ${svc.status}`);
        if (svc.createdAt) console.log(`  Created: ${svc.createdAt.toISOString()}`);
      } else {
        console.log("Scheduler: not deployed");
      }
      console.log("");

      const { ECSFargateRuntime } = await import("../../docker/ecs-runtime.js");
      const runtime = new ECSFargateRuntime(cloud as any);
      console.log(`ECS tasks status (cluster: ${cloud.ecsCluster}):\n`);
      agents = await runtime.listRunningAgents();
    }

    if (agents.length === 0) {
      console.log("No running agents.");
    } else {
      const cols = { agent: 24, task: 40, status: 14, started: 24 };
      console.log(
        "AGENT".padEnd(cols.agent) +
        "TASK".padEnd(cols.task) +
        "STATUS".padEnd(cols.status) +
        "STARTED AT"
      );
      console.log("-".repeat(cols.agent + cols.task + cols.status + cols.started));

      for (const a of agents) {
        console.log(
          a.agentName.padEnd(cols.agent) +
          a.taskId.padEnd(cols.task) +
          a.status.padEnd(cols.status) +
          (a.startedAt ? a.startedAt.toISOString() : "-")
        );
      }
    }
    return;
  }

  const agentNames = discoverAgents(projectPath);

  console.log(`AL Status — ${projectPath}\n`);

  for (const name of agentNames) {
    const agentConfig = loadAgentConfig(projectPath, name);
    console.log(`${name}:`);
    console.log(`  Schedule: ${agentConfig.schedule || "(none)"}`);
    console.log("");
  }

  console.log(`Agents: ${agentNames.join(", ")}`);

  // Fetch and display lock information (local mode only)
  try {
    const response = await fetch("http://localhost:3210/locks/status");
    if (response.ok) {
      const data = await response.json();
      if (data.locks && data.locks.length > 0) {
        console.log("");
        console.log("Active locks:");
        for (const lock of data.locks) {
          const timeAgo = Math.floor((Date.now() - lock.heldSince) / 1000);
          const timeStr = timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo / 60)}m${timeAgo % 60}s`;
          console.log(`  ${lock.agentName}: ${lock.resourceKey} (held for ${timeStr})`);
        }
      }
    }
    // Silently ignore errors (gateway not running, etc.)
  } catch {
    // Gateway not available, skip lock display
  }
}
