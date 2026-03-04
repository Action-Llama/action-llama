import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { discoverAgents, loadAgentConfig } from "../../shared/config.js";

function readStateFile(projectPath: string, agent: string, file: string): any {
  const path = resolve(projectPath, ".al", "state", agent, file);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  const agentNames = discoverAgents(projectPath);

  console.log(`AL Status — ${projectPath}\n`);

  for (const name of agentNames) {
    const agentConfig = loadAgentConfig(projectPath, name);
    console.log(`${name}:`);
    console.log(`  Repos:    ${agentConfig.repos.join(", ")}`);
    console.log(`  Schedule: ${agentConfig.schedule}`);

    // Show state based on which state files exist
    const stateDir = resolve(projectPath, ".al", "state", name);

    if (existsSync(resolve(stateDir, "active-issues.json"))) {
      const devState = readStateFile(projectPath, name, "active-issues.json");
      const issues = devState.issues || {};
      const inProgress = Object.entries(issues).filter(([_, v]: [string, any]) => v.status === "in_progress");
      const completed = Object.entries(issues).filter(([_, v]: [string, any]) => v.status === "completed");
      console.log(`  In progress: ${inProgress.length}`);
      console.log(`  Completed:   ${completed.length}`);
      for (const [key, val] of inProgress as [string, any][]) {
        console.log(`    - ${key} (started ${val.startedAt})`);
      }
    }

    if (existsSync(resolve(stateDir, "reviewed-prs.json"))) {
      const reviewerState = readStateFile(projectPath, name, "reviewed-prs.json");
      const prs = reviewerState.prs || {};
      const prCount = Object.keys(prs).length;
      const approved = Object.values(prs).filter((v: any) => v.verdict === "approved").length;
      const changesRequested = Object.values(prs).filter((v: any) => v.verdict === "changes_requested").length;
      console.log(`  Total reviewed: ${prCount}`);
      console.log(`  Approved:       ${approved}`);
      console.log(`  Changes req:    ${changesRequested}`);
    }

    if (existsSync(resolve(stateDir, "known-errors.json"))) {
      const devopsState = readStateFile(projectPath, name, "known-errors.json");
      const errors = devopsState.errors || {};
      const errorCount = Object.keys(errors).length;
      console.log(`  Errors filed: ${errorCount}`);
    }

    console.log("");
  }

  console.log(`Agents: ${agentNames.join(", ")}`);
}
