---
"@action-llama/action-llama": patch
---

Added MCP server for Claude Code integration. Run `al mcp serve` to start a stdio-based
MCP server that exposes tools for starting/stopping the scheduler, triggering agent runs,
viewing logs, and checking status — all from within Claude Code. New projects created with
`al new` include a `.mcp.json` file so Claude Code discovers the server automatically.
For existing projects, run `al mcp init` to add it.
