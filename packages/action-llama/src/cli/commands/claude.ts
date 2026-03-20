import { resolve } from "path";
import { scaffoldClaudeCommands } from "../../setup/scaffold.js";

export async function init(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  scaffoldClaudeCommands(projectPath);
  console.log(`Wrote Claude Code commands to ${resolve(projectPath, ".claude/commands/")}`);
}
