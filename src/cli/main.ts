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
  .command("start")
  .description("Start cron scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .option("--dangerous-no-docker", "disable Docker container isolation (run agents directly on host)")
  .action(async (opts) => {
    const { execute } = await import("./commands/start.js");
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
  .action(async (agent: string, opts) => {
    const { execute } = await import("./commands/logs.js");
    await execute(agent, opts);
  });

program
  .command("status")
  .description("Show agent status")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/status.js");
    await execute(opts);
  });

program
  .command("setup")
  .description("Ensure all agent credentials exist")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/setup.js");
    await execute(opts);
  });

program.parseAsync().catch((err) => {
  const detail: Record<string, unknown> = { error: err.message };
  if (err.cause) detail.cause = String(err.cause);
  if (err.code) detail.code = err.code;
  if (err.status) detail.status = err.status;
  if (err.stack) detail.stack = err.stack;
  console.error(JSON.stringify(detail));
  process.exit(1);
});
