#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));

const program = new Command();

program
  .name("al")
  .description("Action Llama — automated development agents")
  .version(pkg.version);

// --- User-facing commands ---

program
  .command("new")
  .description("Interactive setup, creates project dir + credentials")
  .argument("<name>", "project name")
  .action(async (name: string) => {
    const { execute } = await import("./commands/new.js");
    await execute(name);
  });

program
  .command("run")
  .description("Manually run a single agent")
  .argument("<agent>", "agent name")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "run on cloud infrastructure")
  .option("-H, --headless", "non-interactive mode (no credential prompts, for CI/deploy environments)")
  .action(async (agent: string, opts) => {
    const { execute } = await import("./commands/run.js");
    await execute(agent, opts);
  });

program
  .command("start")
  .description("Start cron scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "run on cloud infrastructure")
  .option("-H, --headless", "non-interactive mode (no TUI, no credential prompts, for CI/deploy environments)")
  .option("-g, --gateway", "enable the HTTP gateway server (required for webhooks, locks, and web UI)")
  .option("-w, --web-ui", "enable web dashboard at http://localhost:<port>/dashboard (requires -g)")
  .action(async (opts) => {
    const { execute } = await import("./commands/start.js");
    await execute(opts);
  });

program
  .command("doctor")
  .description("Check agents, credentials, webhooks, and config — prompt to fix")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "also push credentials to cloud and reconcile IAM")
  .action(async (opts) => {
    const { execute } = await import("./commands/doctor.js");
    await execute(opts);
  });

program
  .command("logs")
  .description("View agent log files")
  .argument("<agent>", "agent name")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-n, --lines <N>", "number of log entries to show", "50")
  .option("-f, --follow", "tail mode — watch for new log entries")
  .option("-d, --date <YYYY-MM-DD>", "specific date's log file")
  .option("-r, --raw", "show raw JSON log entries instead of conversation view")
  .option("-c, --cloud", "view cloud logs")
  .option("-i, --instance <N>", "instance number (for agents with scale > 1)")
  .action(async (agent: string, opts) => {
    const { execute } = await import("./commands/logs.js");
    await execute(agent, opts);
  });

program
  .command("status")
  .description("Show agent status")
  .option("-p, --project <dir>", "project directory", ".")
  .option("-c, --cloud", "show cloud status")
  .action(async (opts) => {
    const { execute } = await import("./commands/status.js");
    await execute(opts);
  });

program
  .command("kill")
  .description("Kill a running agent instance")
  .argument("<instance-id>", "agent instance ID")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (instanceId: string, opts) => {
    const { execute } = await import("./commands/kill.js");
    await execute(instanceId, opts);
  });

program
  .command("pause")
  .description("Pause the scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/pause.js");
    await execute(opts);
  });

program
  .command("resume")
  .description("Resume the scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/resume.js");
    await execute(opts);
  });

program
  .command("chat")
  .description("Open an interactive Pi coding console with project context")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/chat.js");
    await execute(opts);
  });

program
  .command("optimize")
  .description("Optimize Lambda performance for faster start times")
  .argument("[agent]", "agent name (omit to list all agents)")
  .option("-p, --project <dir>", "project directory", ".")
  .option("--prewarm", "pre-warm the Lambda function")
  .option("--provisioned-concurrency <N>", "set provisioned concurrency (eliminates cold starts)", parseInt)
  .option("--remove-provisioned", "remove provisioned concurrency")
  .option("--status", "show optimization status")
  .action(async (agent: string | undefined, opts) => {
    const { optimizeCommand } = await import("./commands/optimize.js");
    await optimizeCommand(agent, opts);
  });

// --- Credential management ---

const credsCmd = program
  .command("creds")
  .description("Credential management");

credsCmd
  .command("ls")
  .description("List stored credentials grouped by type (no secrets)")
  .action(async () => {
    const { list } = await import("./commands/creds.js");
    await list();
  });

credsCmd
  .command("add <ref>")
  .description("Add or update a credential (e.g. github_token:default)")
  .action(async (ref: string) => {
    const { add } = await import("./commands/creds.js");
    await add(ref);
  });

credsCmd
  .command("rm <ref>")
  .description("Remove a credential (e.g. github_token:default)")
  .action(async (ref: string) => {
    const { rm } = await import("./commands/creds.js");
    await rm(ref);
  });

// --- Cloud management ---

const cloudCmd = program
  .command("cloud")
  .description("Cloud infrastructure management");

cloudCmd
  .command("setup")
  .description("Interactive wizard: pick provider, configure, push creds, provision IAM")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/cloud-setup.js");
    await execute(opts);
  });

cloudCmd
  .command("deploy")
  .description("Build and deploy scheduler + agents to the cloud")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/cloud-deploy.js");
    await execute(opts);
  });

cloudCmd
  .command("teardown")
  .description("Delete per-agent IAM resources and remove [cloud] config")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/cloud-teardown.js");
    await execute(opts);
  });

program.parseAsync().catch((err) => {
  console.error(`\nError: ${err.message}`);
  if (err.cause) console.error(`Cause: ${err.cause}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
