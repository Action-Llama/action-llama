import { resolve } from "path";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";

export async function execute(opts: { project: string; cloud?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  if (opts.cloud) {
    const globalConfig = loadGlobalConfig(projectPath);
    const cloud = globalConfig.cloud;
    if (!cloud) {
      throw new Error("No [cloud] section found in config.toml. Run 'al cloud init' first.");
    }

    const { execFileSync } = await import("child_process");

    if (cloud.provider === "cloud-run") {
      console.log(`Cloud Run Jobs status (project: ${cloud.gcpProject}):\n`);
      try {
        execFileSync("gcloud", [
          "run", "jobs", "list",
          "--project", cloud.gcpProject!,
          "--region", cloud.region!,
          "--filter", "metadata.name:al-",
          "--format", "table(metadata.name,status.conditions[0].type,status.conditions[0].status,metadata.creationTimestamp)",
        ], { stdio: "inherit", timeout: 30_000 });
      } catch (err: any) {
        throw new Error(`Failed to list Cloud Run jobs: ${err.message}`);
      }
    } else {
      console.log(`ECS tasks status (cluster: ${cloud.ecsCluster}):\n`);
      try {
        execFileSync("aws", [
          "ecs", "list-tasks",
          "--cluster", cloud.ecsCluster!,
          "--region", cloud.awsRegion!,
        ], { stdio: "inherit", timeout: 30_000 });
      } catch (err: any) {
        throw new Error(`Failed to list ECS tasks: ${err.message}`);
      }
    }
    return;
  }

  const agentNames = discoverAgents(projectPath);

  console.log(`AL Status — ${projectPath}\n`);

  for (const name of agentNames) {
    const agentConfig = loadAgentConfig(projectPath, name);
    console.log(`${name}:`);
    console.log(`  Repos:    ${agentConfig.repos.join(", ")}`);
    console.log(`  Schedule: ${agentConfig.schedule || "(none)"}`);
    console.log("");
  }

  console.log(`Agents: ${agentNames.join(", ")}`);
}
