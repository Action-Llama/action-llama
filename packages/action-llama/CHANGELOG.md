# @action-llama/action-llama

## 0.14.1

### Patch Changes

- [`51b475e`](https://github.com/Action-Llama/action-llama/commit/51b475eabde69d5a1b1e3ada00fe6973b7adcaf4) Thanks [@asselstine](https://github.com/asselstine)! - Fix release workflow failing because `prepublishOnly` called `npm test` which doesn't exist in the workspace package. Build and test now run explicitly at the monorepo root in CI before publishing.

## 0.14.0

### Minor Changes

- [`3dc2cfe`](https://github.com/Action-Llama/action-llama/commit/3dc2cfefedb4a7a3f63c01ceeb1e46060a5a52f1) Thanks [@asselstine](https://github.com/asselstine)! - Align agent configuration with the Agent Skills specification.

  - Replace ACTIONS.md + agent-config.toml with a single SKILL.md file. All agent
    config (credentials, schedule, hooks, params, model) lives in YAML frontmatter.
    The markdown body is the agent's instructions.
  - Replace the preflight provider system with simple shell command hooks.
    `hooks.pre` runs before the LLM session, `hooks.post` runs after.
  - Add `!` backtick context injection in SKILL.md body — inline shell commands
    whose output is injected into the prompt at startup.
  - Rename agent-to-agent call commands: `al-call` → `al-subagent`,
    `al-check` → `al-subagent-check`, `al-wait` → `al-subagent-wait`.
  - Add `description` field to agents, surfaced in `al stat`, web dashboard,
    chat, and subagent catalog.
  - Align name validation: 64-char limit, reject consecutive hyphens.

- [`d0b904a`](https://github.com/Action-Llama/action-llama/commit/d0b904a825048024e2abf125bfc96619469a7e73) Thanks [@asselstine](https://github.com/asselstine)! - Replaced singular `[model]` config with named models (`[models.<name>]`) and model
  fallback chains. Define models once in `config.toml`, reference by name in SKILL.md
  frontmatter (`models: [sonnet, haiku]`). First model is primary; the rest are tried
  automatically on rate limits via an in-memory circuit breaker. Breaking change: the
  old `[model]` section in config.toml and inline `model:` block in SKILL.md are removed.

- [`5c40e0e`](https://github.com/Action-Llama/action-llama/commit/5c40e0e1ed25d6534e3a04706365eb993562f8af) Thanks [@asselstine](https://github.com/asselstine)! - Nest AL-specific SKILL.md fields under `metadata` key for platform compatibility.

  Action Llama's custom frontmatter fields (`credentials`, `models`, `schedule`, `webhooks`, `hooks`, `params`, `scale`, `timeout`) now live under a `metadata` key in SKILL.md. Top-level fields `description`, `license`, and `compatibility` remain at the top level as they are allowed by the external platform. This is a breaking change to the SKILL.md format — existing SKILL.md files must be updated to the new structure.

- [#193](https://github.com/Action-Llama/action-llama/pull/193) [`8ea439e`](https://github.com/Action-Llama/action-llama/commit/8ea439e2b38821714916f177c356269c0d6219d5) Thanks [@asselstine](https://github.com/asselstine)! - Resource locks now require valid URIs as resource keys. The lock system will validate that resource keys follow proper URI format with valid schemes (e.g., github://, https://, file://). This ensures consistency and prevents malformed lock keys.

  **Breaking change:** Agents using non-URI resource keys (such as "github issue owner/repo#123") will need to update their lock keys to proper URI format (such as "github://owner/repo/issues/123"). The lock skill documentation has been updated with proper URI examples.

### Patch Changes

- [`8aae8b9`](https://github.com/Action-Llama/action-llama/commit/8aae8b9d520b39b74bbbe6320cf6a49a63e0a5ce) Thanks [@asselstine](https://github.com/asselstine)! - Added MCP server for Claude Code integration. Run `al mcp serve` to start a stdio-based
  MCP server that exposes tools for starting/stopping the scheduler, triggering agent runs,
  viewing logs, and checking status — all from within Claude Code. New projects created with
  `al new` include a `.mcp.json` file so Claude Code discovers the server automatically.
  For existing projects, run `al mcp init` to add it.

- [`59f510c`](https://github.com/Action-Llama/action-llama/commit/59f510cb212da9f587342954b0814a2b6c6b6da3) Thanks [@asselstine](https://github.com/asselstine)! - Added Claude Code slash commands bootstrapped into new projects. Five commands
  (/new-agent, /run, /debug, /iterate, /status) help developers build and iterate
  on agents from Claude Code. Run `al claude init` to add them to existing projects.

- [`26311f7`](https://github.com/Action-Llama/action-llama/commit/26311f7d8d186bfe896125f24fdb5889c9c15563) Thanks [@asselstine](https://github.com/asselstine)! - Restructure web dashboard with Tailwind CSS, light/dark mode, and three-level hierarchy.

  The dashboard now has three levels: top-level overview, agent detail (with paginated instance history and aggregate stats from StatsStore), and instance detail (with run metadata, token breakdown, and live log viewer). Removed redundant Mode, Runtime, and Uptime stats from the top-level header. Added `/api/stats/agents/:name/runs` and `/api/stats/agents/:name/runs/:instanceId` endpoints for paginated run history. Old `/dashboard/agents/:name/logs` URLs redirect to the new agent detail page.

- [`a03374e`](https://github.com/Action-Llama/action-llama/commit/a03374e64697ed39aa61c326acd3b34d8dd2fb80) Thanks [@asselstine](https://github.com/asselstine)! - Include file paths in config parse errors. YAML frontmatter errors (SKILL.md) and TOML parse errors (config.toml, .env.toml, environment files) now show which file contains the syntax error.

- [`05ab386`](https://github.com/Action-Llama/action-llama/commit/05ab3866dc68521beb1d4b89dd47287fc2147238) Thanks [@asselstine](https://github.com/asselstine)! - Fix instance log route rejecting valid instance IDs. The `/api/logs/agents/:name/:instanceId` endpoint expected only the hex suffix but the dashboard passes the full instance ID (e.g., `planner-e778111c`). The route now treats the instance ID as an opaque string and uses it directly as the log filter.

- [#197](https://github.com/Action-Llama/action-llama/pull/197) [`f3530dc`](https://github.com/Action-Llama/action-llama/commit/f3530dc1d3e3f29dc384b1a27e9ad6af83b45ab1) Thanks [@asselstine](https://github.com/asselstine)! - Fixed MCP server agent info display to show all configured models instead of failing with TypeScript error. The server now correctly accesses the `models` array property instead of the non-existent `model` property. Closes [#196](https://github.com/Action-Llama/action-llama/issues/196).

- [`fa2cbb4`](https://github.com/Action-Llama/action-llama/commit/fa2cbb4747d4fd1848c7c7a1f1160039840514fb) Thanks [@asselstine](https://github.com/asselstine)! - Restructured the project into an npm workspaces monorepo with three packages:
  `@action-llama/action-llama` (CLI, published), `@action-llama/shared` (shared types, private),
  and `@action-llama/docs` (Mintlify docs, private). This is a structural change with no
  behavior differences — all existing functionality, configuration, and Docker builds work identically.

- [`d4227be`](https://github.com/Action-Llama/action-llama/commit/d4227bec29ea9b6981c60175ec316976ec036068) Thanks [@asselstine](https://github.com/asselstine)! - Added local SQLite telemetry store (`.al/stats.db`) that persists agent run history
  across scheduler restarts. Records duration, token usage, cost, hook timing, and
  agent-to-agent call edges. View with `al stats [agent]`, `al stats --calls`, or
  `al stats --json`. Data auto-prunes after 90 days.

  Also renamed `al stat` to `al status` (`stat` remains as an alias for backward
  compatibility), and added post-hook execution to the host agent runner.

- [`0e3afaa`](https://github.com/Action-Llama/action-llama/commit/0e3afaaf977d78f638c2bf288e587447d2bb0fec) Thanks [@asselstine](https://github.com/asselstine)! - Moved lock timeout config from `gateway.lockTimeout` to top-level `resourceLockTimeout`
  for clarity. The setting controls how long resource locks live before expiring (default
  1800s / 30 minutes). The old `gateway.lockTimeout` field is no longer recognized.

- [`e5643f3`](https://github.com/Action-Llama/action-llama/commit/e5643f3dd52df7deaf6fae73ac04f732294c69c8) Thanks [@asselstine](https://github.com/asselstine)! - Improve `al doctor` webhook validation: validate that webhook source types are known providers (catches typos like "githib"), warn when non-test webhook sources have no credential configured (accepts unsigned webhooks), and fix missing Linear/Mintlify entries in credential collection so their webhook secrets are properly checked.
