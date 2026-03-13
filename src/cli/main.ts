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
  .option("-c, --cloud", "run on cloud infrastructure")
  .option("-H, --headless", "non-interactive mode (no credential prompts, for CI/deploy environments)")
  .action(withCommand(async (agent: string, opts) => {
    const { execute } = await import("./commands/run.js");
    await execute(agent, opts);
  }));

program
  .command("start")
  .description("Start cron scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "run on cloud infrastructure")
  .option("-H, --headless", "non-interactive mode (no TUI, no credential prompts, for CI/deploy environments)")
  .option("-g, --gateway", "enable the HTTP gateway server (required for webhooks, locks, and web UI)")
  .option("-w, --web-ui", "enable web dashboard at http://localhost:<port>/dashboard (requires -g)")
  .action(withCommand(async (opts) => {
    initializeTelemetryForProject(opts.project);
    const { execute } = await import("./commands/start.js");
    await execute(opts);
  }));

program
  .command("doctor")
  .description("Check agents, credentials, webhooks, and config — prompt to fix")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "also push credentials to cloud and reconcile IAM")
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
  .option("-c, --cloud", "view cloud logs")
  .option("-i, --instance <N>", "instance number (for agents with scale > 1)")
  .action(withCommand(async (agent: string, opts) => {
    const { execute } = await import("./commands/logs.js");
    await execute(agent, opts);
  }));

program
  .command("status")
  .description("Show agent status")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "show cloud status")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/status.js");
    await execute(opts);
  }));

program
  .command("kill")
  .description("Kill a running agent instance")
  .argument("<instance-id>", "agent instance ID")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (instanceId: string, opts) => {
    const { execute } = await import("./commands/kill.js");
    await execute(instanceId, opts);
  }));

program
  .command("pause")
  .description("Pause the scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/pause.js");
    await execute(opts);
  }));

program
  .command("resume")
  .description("Resume the scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/resume.js");
    await execute(opts);
  }));

program
  .command("chat")
  .description("Open an interactive Pi coding console with project context")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/chat.js");
    await execute(opts);
  }));

// --- Per-agent control ---

const agentCmd = program
  .command("agent")
  .description("Per-agent control commands");

agentCmd
  .command("pause")
  .description("Pause an agent (stop scheduling new runs, in-flight runs finish)")
  .argument("<name>", "agent name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (name: string, opts) => {
    const { execute } = await import("./commands/agent-pause.js");
    await execute(name, opts);
  }));

agentCmd
  .command("resume")
  .description("Resume a paused agent")
  .argument("<name>", "agent name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (name: string, opts) => {
    const { execute } = await import("./commands/agent-resume.js");
    await execute(name, opts);
  }));

agentCmd
  .command("kill")
  .description("Kill all running instances of an agent")
  .argument("<name>", "agent name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (name: string, opts) => {
    const { execute } = await import("./commands/agent-kill.js");
    await execute(name, opts);
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
  .description("Add or update a credential (e.g. github_token:default)")
  .action(withCommand(async (ref: string) => {
    const { add } = await import("./commands/creds.js");
    await add(ref);
  }));

credsCmd
  .command("rm <ref>")
  .description("Remove a credential (e.g. github_token:default)")
  .action(withCommand(async (ref: string) => {
    const { rm } = await import("./commands/creds.js");
    await rm(ref);
  }));

// --- Cloud management ---

const cloudCmd = program
  .command("cloud")
  .description("Cloud infrastructure management");

cloudCmd
  .command("setup")
  .description("Interactive wizard: pick provider, configure, push creds, provision IAM")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/cloud-setup.js");
    await execute(opts);
  }));

cloudCmd
  .command("deploy")
  .description("Build and deploy scheduler + agents to the cloud")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/cloud-deploy.js");
    await execute(opts);
  }));

cloudCmd
  .command("teardown")
  .description("Delete per-agent IAM resources and remove [cloud] config")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/cloud-teardown.js");
    await execute(opts);
  }));

program.parseAsync().catch((err) => {
  // Fallback for errors that escape command handlers (e.g. Commander parse errors)
  console.error(`\nError: ${err.message}`);
  if (err.cause) console.error(`Cause: ${err.cause}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
