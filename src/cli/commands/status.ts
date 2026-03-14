import { resolve } from "path";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { gatewayFetch } from "../gateway-client.js";
import type { RunningAgent } from "../../docker/runtime.js";
import type { AgentInstance } from "../../scheduler/types.js";

export async function execute(opts: { project: string; cloud?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  if (opts.cloud) {
    const globalConfig = loadGlobalConfig(projectPath);
    const cloud = globalConfig.cloud;
    if (!cloud) {
      throw new Error("No [cloud] section found in config.toml. Run 'al setup cloud' first.");
    }

    const { createCloudProvider } = await import("../../cloud/provider.js");
    const provider = await createCloudProvider(cloud);

    // Show scheduler service status
    const svc = await provider.getSchedulerStatus();
    if (svc) {
      console.log(`Scheduler (${cloud.provider}):`);
      console.log(`  URL:    ${svc.serviceUrl}`);
      console.log(`  Status: ${svc.status}`);
      if (svc.createdAt) console.log(`  Created: ${svc.createdAt.toISOString()}`);
    } else {
      console.log("Scheduler: not deployed");
    }
    console.log("");

    // List running agents
    const runtime = provider.createRuntime();
    const agents: RunningAgent[] = await runtime.listRunningAgents();

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

  // Try to get running instances from gateway if available
  let schedulerInfo = null;
  let instances: AgentInstance[] = [];
  let agentStatuses: Array<{ name: string; enabled: boolean }> = [];

  try {
    const response = await gatewayFetch({ project: projectPath, path: "/control/status" });
    if (response.ok) {
      const data = await response.json();
      schedulerInfo = data.scheduler;
      instances = data.instances || [];
      agentStatuses = data.agents || [];
    }
  } catch (error) {
    // Gateway not running or not accessible, continue with basic info
  }

  // Show scheduler state if available
  if (schedulerInfo) {
    console.log("Scheduler:");
    console.log(`  Status: ${schedulerInfo.paused ? "PAUSED" : "Running"}`);
    console.log(`  Mode: ${schedulerInfo.mode}`);
    if (schedulerInfo.runtime) {
      console.log(`  Runtime: ${schedulerInfo.runtime}`);
    }
    if (schedulerInfo.gatewayPort) {
      console.log(`  Gateway: http://localhost:${schedulerInfo.gatewayPort}`);
    }
    console.log("");
  }

  // Show running instances if any
  if (instances.length > 0) {
    console.log("Running Instances:");
    const cols = { agent: 20, instance: 24, status: 12, started: 20, trigger: 20 };
    console.log(
      "AGENT".padEnd(cols.agent) +
      "INSTANCE ID".padEnd(cols.instance) +
      "STATUS".padEnd(cols.status) +
      "STARTED".padEnd(cols.started) +
      "TRIGGER"
    );
    console.log("-".repeat(cols.agent + cols.instance + cols.status + cols.started + cols.trigger));

    for (const instance of instances) {
      const instanceIdShort = instance.id.length > 20 ?
        `...${instance.id.slice(-17)}` : instance.id;

      console.log(
        instance.agentName.padEnd(cols.agent) +
        instanceIdShort.padEnd(cols.instance) +
        instance.status.padEnd(cols.status) +
        instance.startedAt.toISOString().slice(0, 19).replace('T', ' ').padEnd(cols.started) +
        (instance.trigger || "-")
      );
    }
    console.log("");
  } else if (schedulerInfo) {
    console.log("No running instances.\n");
  }

  // Show agent configuration
  for (const name of agentNames) {
    const agentConfig = loadAgentConfig(projectPath, name);
    const agentStatus = agentStatuses.find(a => a.name === name);
    const pausedSuffix = agentStatus && !agentStatus.enabled ? " (PAUSED)" : "";
    console.log(`${name}:${pausedSuffix}`);
    console.log(`  Schedule: ${agentConfig.schedule || "(none)"}`);
    console.log("");
  }

  console.log(`Agents: ${agentNames.join(", ")}`);

  // Fetch and display lock information (local mode only)
  try {
    const response = await gatewayFetch({ project: projectPath, path: "/locks/status" });
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
