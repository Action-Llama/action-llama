import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

export async function serve(opts: { project: string; env?: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const { startMcpServer } = await import("../../mcp/server.js");
  await startMcpServer({ projectPath, envName: opts.env });
}

export async function init(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const mcpJsonPath = resolve(projectPath, ".mcp.json");

  const entry = {
    command: "al",
    args: ["mcp", "serve"],
  };

  if (existsSync(mcpJsonPath)) {
    const existing = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    if (!existing.mcpServers) existing.mcpServers = {};

    if (existing.mcpServers["action-llama"]) {
      console.log(".mcp.json already has an action-llama server entry. Overwriting.");
    }

    existing.mcpServers["action-llama"] = entry;
    writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n");
  } else {
    const content = { mcpServers: { "action-llama": entry } };
    writeFileSync(mcpJsonPath, JSON.stringify(content, null, 2) + "\n");
  }

  console.log(`Wrote ${mcpJsonPath}`);
}
