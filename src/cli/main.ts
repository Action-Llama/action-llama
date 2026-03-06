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
  .option("--no-docker", "disable Docker container isolation (run agents directly on host)")
  .option("-c, --cloud", "run on cloud infrastructure")
  .action(async (agent: string, opts) => {
    const { execute } = await import("./commands/run.js");
    await execute(agent, opts);
  });

program
  .command("start")
  .description("Start cron scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .option("--no-docker", "disable Docker container isolation (run agents directly on host)")
  .option("-c, --cloud", "run on cloud infrastructure")
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
  .option("-c, --cloud", "view cloud logs")
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
  .command("console")
  .description("Open an interactive Pi coding console with project context")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/console.js");
    await execute(opts);
  });

// --- Credential management ---

const credsCmd = program
  .command("creds")
  .description("Credential management");

credsCmd
  .command("ls")
  .description("List stored credentials (names only, no secrets)")
  .action(async () => {
    const { list } = await import("./commands/creds.js");
    await list();
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
