#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { withCommand } from "./with-command.js";
import { initTelemetry, getTelemetry } from "../telemetry/index.js";
import { loadGlobalConfig } from "../shared/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));

const program = new Command();

program
  .name("al")
  .description("Action Llama — automated development agents")
  .version(pkg.version);

// Initialize telemetry based on project config if available
function initializeTelemetryForProject(projectPath: string = ".") {
  try {
    const globalConfig = loadGlobalConfig(projectPath);
    if (globalConfig.telemetry?.enabled) {
      const telemetry = initTelemetry(globalConfig.telemetry);
      telemetry.init().catch((error) => {
        // Silent fail to avoid disrupting CLI operation
        console.debug("Failed to initialize telemetry:", error);
      });

      // Ensure telemetry shutdown on process exit
      const gracefulShutdown = async () => {
        try {
          await telemetry.shutdown();
        } catch (error) {
          console.debug("Error during telemetry shutdown:", error);
        }
      };

      process.on("SIGINT", gracefulShutdown);
      process.on("SIGTERM", gracefulShutdown);
      process.on("beforeExit", gracefulShutdown);
    }
  } catch (error) {
    // Ignore config loading errors - may not be in a project directory
  }
}

// --- User-facing commands ---

program
  .command("new")
  .description("Interactive setup, creates project dir + credentials")
  .argument("<name>", "project name")
  .action(withCommand(async (name: string) => {
    const { execute } = await import("./commands/new.js");
    await execute(name);
  }));

program
  .command("run")
  .description("Manually run a single agent")
  .argument("<agent>", "agent name")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named deployment environment")
  .option("-H, --headless", "non-interactive mode (no credential prompts, for CI/deploy environments)")
  .action(withCommand(async (agent: string, opts) => {
    const { execute } = await import("./commands/run.js");
    await execute(agent, opts);
  }));

program
  .command("start")
  .description("Start the scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named deployment environment")
  .option("-H, --headless", "non-interactive mode (no TUI, no credential prompts, for CI/deploy environments)")
  .option("-w, --web-ui", "enable web dashboard at http://localhost:<port>/dashboard")
  .option("-e, --expose", "bind gateway to 0.0.0.0 (public) while keeping local mode features")
  .option("--port <number>", "override gateway port", parseInt)
  .action(withCommand(async (opts) => {
    initializeTelemetryForProject(opts.project);
    const { execute } = await import("./commands/start.js");
    await execute(opts);
  }));

program
  .command("stop")
  .description("Stop the scheduler and clear pending agent queues")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "environment name")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/stop.js");
    await execute(opts);
  }));

program
  .command("doctor")
  .description("Check agents, credentials, webhooks, and config — prompt to fix")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named environment; validate configuration")
  .option("--strict", "treat unknown config fields as errors instead of warnings")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/doctor.js");
    await execute(opts);
  }));

program
  .command("logs")
  .description("View agent log files (defaults to scheduler logs)")
  .argument("[agent]", "agent name (omit for scheduler logs)", "scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-n, --lines <N>", "number of log entries to show", "50")
  .option("-f, --follow", "tail mode — watch for new log entries")
  .option("-d, --date <YYYY-MM-DD>", "specific date's log file")
  .option("-r, --raw", "show raw JSON log entries instead of conversation view")
  .option("-E, --env <name>", "use named environment")
  .option("-i, --instance <N>", "instance number (for agents with scale > 1)")
  .action(withCommand(async (agent: string, opts) => {
    const { execute } = await import("./commands/logs.js");
    await execute(agent, opts);
  }));

program
  .command("status [agent]")
  .alias("stat")
  .description("Show status of scheduler or agent")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named environment")
  .action(withCommand(async (agent, opts) => {
    const { execute } = await import("./commands/status.js");
    await execute({ ...opts, agent });
  }));

program
  .command("stats")
  .description("Show historical run statistics from local SQLite store")
  .argument("[agent]", "agent name (omit for global summary)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-s, --since <duration>", "time window: e.g. 24h, 7d, 30d", "7d")
  .option("-n <N>", "number of recent runs to show", parseInt, 20)
  .option("--json", "output as JSON")
  .option("--calls", "show call graph summary")
  .action(withCommand(async (agent: string | undefined, opts) => {
    const { execute } = await import("./commands/stats.js");
    await execute({ ...opts, agent });
  }));

program
  .command("kill")
  .description("Kill an agent (all instances) or a single instance by ID")
  .argument("<target>", "agent name or instance ID")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named environment")
  .action(withCommand(async (target: string, opts) => {
    const { execute } = await import("./commands/kill.js");
    await execute(target, opts);
  }));

program
  .command("pause")
  .description("Pause the scheduler, or a single agent by name")
  .argument("[name]", "agent name (omit to pause the entire scheduler)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named environment")
  .action(withCommand(async (name: string | undefined, opts) => {
    const { execute } = await import("./commands/pause.js");
    await execute(name, opts);
  }));

program
  .command("resume")
  .description("Resume the scheduler, or a single agent by name")
  .argument("[name]", "agent name (omit to resume the entire scheduler)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named environment")
  .action(withCommand(async (name: string | undefined, opts) => {
    const { execute } = await import("./commands/resume.js");
    await execute(name, opts);
  }));

program
  .command("chat")
  .description("Open an interactive console (optionally scoped to an agent's environment)")
  .argument("[agent]", "agent name — loads its credentials and environment")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named environment to load credentials")
  .action(withCommand(async (agent: string | undefined, opts) => {
    const { execute } = await import("./commands/chat.js");
    await execute({ ...opts, agent });
  }));

program
  .command("push")
  .description("Deploy project to a self-hosted server via SSH")
  .argument("[agent]", "agent name — push only this agent (hot-reloaded, no restart)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named environment with [server] config")
  .option("-H, --headless", "non-interactive mode (no credential prompts, for CI/deploy environments)")
  .option("--dry-run", "show what would be synced without making changes")
  .option("--no-creds", "skip credential sync")
  .option("--creds-only", "sync only credentials (skip project files)")
  .option("--files-only", "sync only project files (skip credentials)")
  .option("-a, --all", "sync project files, credentials, and restart service")
  .option("--force-install", "force npm install even if dependencies appear unchanged")
  .action(withCommand(async (agent: string | undefined, opts) => {
    const { execute } = await import("./commands/push.js");
    await execute({ ...opts, agent });
  }));

// --- Environment management ---

const envCmd = program
  .command("env")
  .description("Manage deployment environments");

envCmd
  .command("init")
  .description("Create a new environment configuration file")
  .argument("<name>", "environment name (e.g. prod, staging)")
  .requiredOption("-t, --type <type>", "environment type: server")
  .action(withCommand(async (name: string, opts: { type: string }) => {
    const { init } = await import("./commands/env.js");
    await init(name, opts.type);
  }));

envCmd
  .command("list")
  .description("List all configured environments")
  .action(withCommand(async () => {
    const { list } = await import("./commands/env.js");
    await list();
  }));

envCmd
  .command("show")
  .description("Show environment configuration details")
  .argument("<name>", "environment name")
  .action(withCommand(async (name: string) => {
    const { show } = await import("./commands/env.js");
    await show(name);
  }));

envCmd
  .command("set")
  .description("Bind this project to a named environment (omit name to unset)")
  .argument("[name]", "environment name (omit to clear binding and use local)")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (name: string | undefined, opts: { project: string }) => {
    const { set } = await import("./commands/env.js");
    await set(name, opts);
  }));

envCmd
  .command("check")
  .description("Verify environment is provisioned correctly")
  .argument("<name>", "environment name")
  .action(withCommand(async (name: string) => {
    const { check } = await import("./commands/env.js");
    await check(name);
  }));

envCmd
  .command("prov")
  .description("Provision a new VPS and save as an environment")
  .argument("[name]", "environment name (prompted if omitted)")
  .action(withCommand(async (name: string | undefined) => {
    const { prov } = await import("./commands/env.js");
    await prov(name);
  }));

envCmd
  .command("deprov")
  .description("Tear down a provisioned environment and delete its config")
  .argument("<name>", "environment name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (name: string, opts: { project: string }) => {
    const { deprov } = await import("./commands/env.js");
    await deprov(name, opts);
  }));

envCmd
  .command("logs")
  .description("View server system logs for an environment")
  .argument("[name]", "environment name (defaults to configured environment)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-n, --lines <N>", "number of recent log lines to show", "50")
  .option("-f, --follow", "follow log output in real-time")
  .action(withCommand(async (name: string | undefined, opts: { project: string; lines: string; follow?: boolean }) => {
    const { logs } = await import("./commands/env.js");
    await logs(name, opts);
  }));

// --- Credential management ---

const credsCmd = program
  .command("creds")
  .description("Credential management");

credsCmd
  .command("ls")
  .description("List stored credentials grouped by type (no secrets)")
  .action(withCommand(async () => {
    const { list } = await import("./commands/creds.js");
    await list();
  }));

credsCmd
  .command("add <ref>")
  .description("Add or update a credential (e.g. github_token)")
  .action(withCommand(async (ref: string) => {
    const { add } = await import("./commands/creds.js");
    await add(ref);
  }));

credsCmd
  .command("rm <ref>")
  .description("Remove a credential (e.g. github_token)")
  .action(withCommand(async (ref: string) => {
    const { rm } = await import("./commands/creds.js");
    await rm(ref);
  }));

credsCmd
  .command("types")
  .description("Browse available credential types")
  .action(withCommand(async () => {
    const { types } = await import("./commands/creds.js");
    await types();
  }));

// --- Agent management ---

const agentCmd = program
  .command("agent")
  .description("Agent management");

agentCmd
  .command("new")
  .description("Create a new agent from a template")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { newAgent } = await import("./commands/agent.js");
    await newAgent(opts);
  }));

agentCmd
  .command("config")
  .description("Interactively configure an agent")
  .argument("<name>", "agent name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (name: string, opts) => {
    const { configAgent } = await import("./commands/agent.js");
    await configAgent(name, opts);
  }));

// --- Webhook testing ---

const webhookCmd = program
  .command("webhook")
  .description("Webhook testing utilities");

webhookCmd
  .command("replay")
  .alias("simulate")
  .description("Load fixture payloads and test agent webhook matching")
  .argument("<fixture>", "path to webhook fixture file (JSON)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-r, --run", "interactively run a matched agent")
  .option("-s, --source <name>", "webhook source name from config.toml")
  .action(withCommand(async (fixture: string, opts) => {
    const { execute } = await import("./commands/webhook.js");
    await execute("replay", fixture, opts);
  }));

// --- MCP integration ---

const mcpCmd = program
  .command("mcp")
  .description("MCP server for Claude Code integration");

mcpCmd
  .command("serve")
  .description("Start MCP stdio server for Claude Code integration")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-E, --env <name>", "use named deployment environment")
  .action(withCommand(async (opts) => {
    const { serve } = await import("./commands/mcp.js");
    await serve(opts);
  }));

mcpCmd
  .command("init")
  .description("Add Action Llama MCP server to .mcp.json for Claude Code")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { init } = await import("./commands/mcp.js");
    await init(opts);
  }));

// --- Claude Code integration ---

const claudeCmd = program
  .command("claude")
  .description("Claude Code integration");

claudeCmd
  .command("init")
  .description("Add Claude Code slash commands to .claude/commands/")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { init } = await import("./commands/claude.js");
    await init(opts);
  }));

program.parseAsync().catch((err) => {
  // Fallback for errors that escape command handlers (e.g. Commander parse errors)
  console.error(`\nError: ${err.message}`);
  if (err.cause) console.error(`Cause: ${err.cause}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
