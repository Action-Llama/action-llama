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
  .option("-w, --web-ui", "enable web dashboard at http://localhost:<port>/dashboard")
  .option("-e, --expose", "bind gateway to 0.0.0.0 (public) while keeping local mode features")
  .action(withCommand(async (opts) => {
    initializeTelemetryForProject(opts.project);
    const { execute } = await import("./commands/start.js");
    await execute(opts);
  }));

program
  .command("stop")
  .description("Stop the scheduler and clear pending webhook queues")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/stop.js");
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
  .command("stat [agent]")
  .description("Show agent status")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "show cloud status")
  .action(withCommand(async (agent, opts) => {
    const { execute } = await import("./commands/status.js");
    await execute({ ...opts, agent });
  }));

program
  .command("kill")
  .description("Kill an agent (all instances) or a single instance by ID")
  .argument("<target>", "agent name or instance ID")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "kill cloud instances")
  .action(withCommand(async (target: string, opts) => {
    const { execute } = await import("./commands/kill.js");
    await execute(target, opts);
  }));

program
  .command("pause")
  .description("Pause the scheduler, or a single agent by name")
  .argument("[name]", "agent name (omit to pause the entire scheduler)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "pause cloud scheduler or agent")
  .action(withCommand(async (name: string | undefined, opts) => {
    const { execute } = await import("./commands/pause.js");
    await execute(name, opts);
  }));

program
  .command("resume")
  .description("Resume the scheduler, or a single agent by name")
  .argument("[name]", "agent name (omit to resume the entire scheduler)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "resume cloud scheduler or agent")
  .action(withCommand(async (name: string | undefined, opts) => {
    const { execute } = await import("./commands/resume.js");
    await execute(name, opts);
  }));

program
  .command("chat")
  .description("Open an interactive console (optionally scoped to an agent's environment)")
  .argument("[agent]", "agent name — loads its credentials and environment")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "load credentials from cloud secrets manager")
  .action(withCommand(async (agent: string | undefined, opts) => {
    const { execute } = await import("./commands/chat.js");
    await execute({ ...opts, agent });
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

// --- Setup management ---

const setupCmd = program
  .command("setup")
  .description("Setup infrastructure and configuration");

setupCmd
  .command("cloud")
  .description("Interactive wizard: pick provider, configure, push creds, provision IAM")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/cloud-setup.js");
    await execute(opts);
  }));

// --- Teardown management ---

const teardownCmd = program
  .command("teardown")
  .description("Teardown infrastructure and configuration");

teardownCmd
  .command("cloud")
  .description("Delete per-agent IAM resources and remove [cloud] config")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/cloud-teardown.js");
    await execute(opts);
  }));

// --- Cloud management ---

const cloudCmd = program
  .command("cloud")
  .description("Cloud infrastructure management");

cloudCmd
  .command("deploy")
  .description("Build and deploy scheduler + agents to the cloud")
  .option("-p, --project <dir>", "project directory", ".")
  .action(withCommand(async (opts) => {
    const { execute } = await import("./commands/cloud-deploy.js");
    await execute(opts);
  }));

program.parseAsync().catch((err) => {
  // Fallback for errors that escape command handlers (e.g. Commander parse errors)
  console.error(`\nError: ${err.message}`);
  if (err.cause) console.error(`Cause: ${err.cause}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
