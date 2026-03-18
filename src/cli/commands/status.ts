import { resolve } from "path";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { gatewayFetch } from "../gateway-client.js";
import { resolveEnvironmentName } from "../../shared/environment.js";
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

  const envName = resolveEnvironmentName(opts.env, projectPath);
  const isRemote = !!envName;

  let schedulerInfo = null;
  let instances: AgentInstance[] = [];
  let agentStatuses: Array<{ name: string; enabled: boolean }> = [];

  try {
    const response = await gatewayFetch({ project: projectPath, path: "/control/status", env: envName || undefined });
    if (response.ok) {
      const data = await response.json();
      schedulerInfo = data.scheduler;
      instances = data.instances || [];
      agentStatuses = data.agents || [];
    } else if (isRemote) {
      const globalConfig = loadGlobalConfig(projectPath, opts.env);
      const url = globalConfig.gateway?.url || `localhost:${globalConfig.gateway?.port || 8080}`;
      console.error(`Failed to reach gateway at ${url} (HTTP ${response.status})`);
      process.exit(1);
    }
  } catch (error) {
    if (isRemote) {
      const globalConfig = loadGlobalConfig(projectPath, opts.env);
      const url = globalConfig.gateway?.url || `localhost:${globalConfig.gateway?.port || 8080}`;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Cannot connect to gateway at ${url}: ${msg}`);
      process.exit(1);
    }
    // Local mode: gateway not running, continue with basic info
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

  // Fetch and display lock information
  try {
    const response = await gatewayFetch({ project: projectPath, path: "/locks/status", env: envName || undefined });
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
