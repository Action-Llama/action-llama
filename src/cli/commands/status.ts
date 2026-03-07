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

    if (cloud.provider === "cloud-run") {
      const { CloudRunJobRuntime } = await import("../../docker/cloud-run-runtime.js");
      const runtime = new CloudRunJobRuntime(cloud as any);
      console.log(`Cloud Run Jobs status (project: ${cloud.gcpProject}):\n`);
      agents = await runtime.listRunningAgents();
    } else {
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
}
