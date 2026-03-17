import { resolve } from "path";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { gatewayFetch } from "../gateway-client.js";
import type { RunningAgent } from "../../docker/runtime.js";
import type { AgentInstance } from "../../scheduler/types.js";
import type { AgentConfig } from "../../shared/config.js";

/** Concise trigger types for the summary table. */
function formatTriggerShort(config: AgentConfig): string {
  const parts: string[] = [];
  if (config.schedule) parts.push("cron");
  if (config.webhooks?.length) parts.push("webhook");
  return parts.length > 0 ? parts.join(" + ") : "(manual)";
}

/** Print the unified agents summary table. */
function printAgentsTable(
  rows: Array<{ config: AgentConfig; status: string; instanceCount: number; paused: boolean }>,
): void {
  const cols = { agent: 16, trigger: 16, status: 12, instances: 12 };
  console.log(
    "AGENT".padEnd(cols.agent) +
    "TRIGGER".padEnd(cols.trigger) +
    "STATUS".padEnd(cols.status) +
    "INSTANCES"
  );
  console.log("-".repeat(cols.agent + cols.trigger + cols.status + cols.instances));

  for (const { config, status, instanceCount, paused } of rows) {
    const trigger = formatTriggerShort(config);
    const statusStr = paused ? "PAUSED" : status;
    const instanceStr = instanceCount > 0 ? `${instanceCount} running` : "0";

    console.log(
      config.name.padEnd(cols.agent) +
      trigger.padEnd(cols.trigger) +
      statusStr.padEnd(cols.status) +
      instanceStr
    );
  }
}

/** Print detailed config for a single agent. */
function printAgentConfig(config: AgentConfig): void {
  console.log("Config:");
  console.log(`  Schedule: ${config.schedule || "(none)"}`);

  if (config.webhooks?.length) {
    console.log("  Webhooks:");
    for (const wh of config.webhooks) {
      const filters: string[] = [];
      if (wh.events?.length) filters.push(wh.events.join(", "));
      if (wh.repos?.length) filters.push(`repos: ${wh.repos.join(", ")}`);
      console.log(`    ${wh.source}${filters.length ? `: ${filters.join("; ")}` : ""}`);
    }
  }

  if (config.scale && config.scale > 1) console.log(`  Scale: ${config.scale}`);
  if (config.timeout) console.log(`  Timeout: ${config.timeout}s`);
}

/** Print cloud running instances table. */
function printCloudInstances(instances: RunningAgent[]): void {
  if (instances.length === 0) {
    console.log("No running instances.");
    return;
  }

  console.log("Running Instances:");
  const cols = { agent: 16, task: 40, status: 14, trigger: 20, started: 24 };
  console.log(
    "AGENT".padEnd(cols.agent) +
    "TASK".padEnd(cols.task) +
    "STATUS".padEnd(cols.status) +
    "TRIGGER".padEnd(cols.trigger) +
    "STARTED AT"
  );
  console.log("-".repeat(cols.agent + cols.task + cols.status + cols.trigger + cols.started));

  for (const a of instances) {
    console.log(
      a.agentName.padEnd(cols.agent) +
      a.taskId.padEnd(cols.task) +
      a.status.padEnd(cols.status) +
      (a.trigger || "-").padEnd(cols.trigger) +
      (a.startedAt ? a.startedAt.toISOString().slice(0, 19).replace('T', ' ') : "-")
    );
  }
}

/** Print local running instances table. */
function printLocalInstances(instances: AgentInstance[]): void {
  if (instances.length === 0) return;

  console.log("Running Instances:");
  const cols = { agent: 16, instance: 24, status: 12, trigger: 20, started: 20 };
  console.log(
    "AGENT".padEnd(cols.agent) +
    "INSTANCE ID".padEnd(cols.instance) +
    "STATUS".padEnd(cols.status) +
    "TRIGGER".padEnd(cols.trigger) +
    "STARTED"
  );
  console.log("-".repeat(cols.agent + cols.instance + cols.status + cols.trigger + cols.started));

  for (const instance of instances) {
    const instanceIdShort = instance.id.length > 20 ?
      `...${instance.id.slice(-17)}` : instance.id;

    console.log(
      instance.agentName.padEnd(cols.agent) +
      instanceIdShort.padEnd(cols.instance) +
      instance.status.padEnd(cols.status) +
      (instance.trigger || "-").padEnd(cols.trigger) +
      instance.startedAt.toISOString().slice(0, 19).replace('T', ' ')
    );
  }
}

export async function execute(opts: { project: string; env?: string; agent?: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const globalConfig = loadGlobalConfig(projectPath, opts.env);
  const cloudMode = !!globalConfig.cloud;

  if (cloudMode) {
    const cloud = globalConfig.cloud!;

    const { createCloudProvider } = await import("../../cloud/provider.js");
    const provider = await createCloudProvider(cloud);
    const runtime = provider.createRuntime();
    const running: RunningAgent[] = await runtime.listRunningAgents();

    // --- Per-agent detail view ---
    if (opts.agent) {
      const config = loadAgentConfig(projectPath, opts.agent);
      const agentInstances = running.filter(a => a.agentName === opts.agent);

      console.log(`Agent: ${opts.agent}\n`);
      printAgentConfig(config);
      console.log("");
      printCloudInstances(agentInstances);
      return;
    }

    // --- Summary view ---
    console.log(`AL Status — ${projectPath}\n`);

    const svc = await provider.getSchedulerStatus();
    if (svc) {
      console.log(`Scheduler (${cloud.provider}):`);
      console.log(`  Status: ${svc.status}`);
      console.log(`  URL:    ${svc.serviceUrl}`);
      if (svc.createdAt) console.log(`  Created: ${svc.createdAt.toISOString()}`);
      if (svc.updatedAt) console.log(`  Updated: ${svc.updatedAt.toISOString()}`);
    } else {
      console.log("Scheduler: not deployed");
    }
    console.log("");

    const agentNames = discoverAgents(projectPath);
    const instanceCounts = new Map<string, number>();
    for (const a of running) {
      instanceCounts.set(a.agentName, (instanceCounts.get(a.agentName) || 0) + 1);
    }

    console.log("Agents:");
    const agentRows = agentNames.map(name => {
      const config = loadAgentConfig(projectPath, name);
      const count = instanceCounts.get(name) || 0;
      return {
        config,
        status: count > 0 ? "Running" : "Idle",
        instanceCount: count,
        paused: false,
      };
    });
    printAgentsTable(agentRows);
    console.log("");

    printCloudInstances(running);
    return;
  }

  // --- Local mode ---

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

  // --- Per-agent detail view ---
  if (opts.agent) {
    const config = loadAgentConfig(projectPath, opts.agent);
    const agentInstances = instances.filter(i => i.agentName === opts.agent);
    const agentStatus = agentStatuses.find(a => a.name === opts.agent);

    console.log(`Agent: ${opts.agent}`);
    if (agentStatus && !agentStatus.enabled) console.log("  Status: PAUSED");
    console.log("");
    printAgentConfig(config);
    console.log("");
    printLocalInstances(agentInstances);
    return;
  }

  // --- Summary view ---
  const agentNames = discoverAgents(projectPath);
  console.log(`AL Status — ${projectPath}\n`);

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

  const instanceCounts = new Map<string, number>();
  for (const inst of instances) {
    if (inst.status === 'running') {
      instanceCounts.set(inst.agentName, (instanceCounts.get(inst.agentName) || 0) + 1);
    }
  }

  console.log("Agents:");
  const agentRows = agentNames.map(name => {
    const config = loadAgentConfig(projectPath, name);
    const agentStatus = agentStatuses.find(a => a.name === name);
    const count = instanceCounts.get(name) || 0;
    const paused = agentStatus ? !agentStatus.enabled : false;
    return {
      config,
      status: count > 0 ? "Running" : "Idle",
      instanceCount: count,
      paused,
    };
  });
  printAgentsTable(agentRows);
  console.log("");

  if (instances.length > 0) {
    printLocalInstances(instances);
    console.log("");
  } else if (schedulerInfo) {
    console.log("No running instances.\n");
  }

  // Fetch and display lock information (local mode only)
  try {
    const response = await gatewayFetch({ project: projectPath, path: "/locks/status" });
    if (response.ok) {
      const data = await response.json();
      if (data.locks && data.locks.length > 0) {
        console.log("Active locks:");
        for (const lock of data.locks) {
          const timeAgo = Math.floor((Date.now() - lock.heldSince) / 1000);
          const timeStr = timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo / 60)}m${timeAgo % 60}s`;
          console.log(`  ${lock.agentName}: ${lock.resourceKey} (held for ${timeStr})`);
        }
      }
    }
  } catch {
    // Gateway not available, skip lock display
  }
}
