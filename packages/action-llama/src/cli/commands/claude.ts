export async function init(_opts: { project: string }): Promise<void> {
  console.log("To install Action Llama skills for Claude Code, run:\n");
  console.log("  npx skills add Action-Llama/skill\n");
  console.log("This installs the al plugin with skills for creating, running, and debugging agents.");
}
