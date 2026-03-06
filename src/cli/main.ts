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
  .option("--remote <name>", "use credentials from a remote store")
  .option("--dangerous-no-docker", "disable Docker container isolation (run agents directly on host)")
  .action(async (agent: string, opts) => {
    if (opts.remote) {
      const { initRemoteBackend } = await import("./remote-init.js");
      await initRemoteBackend(opts.project || ".", opts.remote);
    }
    const { execute } = await import("./commands/run.js");
    await execute(agent, opts);
  });

program
  .command("start")
  .description("Start cron scheduler")
  .option("-p, --project <dir>", "project directory", ".")
  .option("--remote <name>", "use credentials from a remote store")
  .option("--dangerous-no-docker", "disable Docker container isolation (run agents directly on host)")
  .action(async (opts) => {
    if (opts.remote) {
      const { initRemoteBackend } = await import("./remote-init.js");
      await initRemoteBackend(opts.project || ".", opts.remote);
    }
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
  .option("--cloud", "create per-agent IAM resources for cloud runtimes (Cloud Run or ECS)")
  .action(async (opts) => {
    if (opts.cloud) {
      const { execute } = await import("./commands/setup-cloud.js");
      await execute(opts);
    } else {
      const { execute } = await import("./commands/setup.js");
      await execute(opts);
    }
  });

program
  .command("console")
  .description("Open an interactive Pi coding console with project context")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { execute } = await import("./commands/console.js");
    await execute(opts);
  });

// --- Remote management ---

const remoteCmd = program
  .command("remote")
  .description("Manage remote credential stores");

remoteCmd
  .command("add")
  .description("Add a remote credential store")
  .argument("<name>", "remote name (e.g. production)")
  .requiredOption("--provider <provider>", "backend provider (gsm, asm)")
  .option("--gcp-project <id>", "GCP project ID (required for gsm)")
  .option("--aws-region <region>", "AWS region (required for asm)")
  .option("--secret-prefix <prefix>", "secret name prefix (default: action-llama)")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (name: string, opts) => {
    const { executeAdd } = await import("./commands/remote.js");
    await executeAdd(name, opts);
  });

remoteCmd
  .command("list")
  .description("List configured remotes")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (opts) => {
    const { executeList } = await import("./commands/remote.js");
    await executeList(opts);
  });

remoteCmd
  .command("remove")
  .description("Remove a remote")
  .argument("<name>", "remote name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (name: string, opts) => {
    const { executeRemove } = await import("./commands/remote.js");
    await executeRemove(name, opts);
  });

// --- Credential push/pull ---

const credsCmd = program
  .command("creds")
  .description("Manage credentials across local and remote stores");

credsCmd
  .command("push")
  .description("Push local credentials to a remote store")
  .argument("<remote>", "remote name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (remote: string, opts) => {
    const { executePush } = await import("./commands/creds.js");
    await executePush(remote, opts);
  });

credsCmd
  .command("pull")
  .description("Pull credentials from a remote store to local")
  .argument("<remote>", "remote name")
  .option("-p, --project <dir>", "project directory", ".")
  .action(async (remote: string, opts) => {
    const { executePull } = await import("./commands/creds.js");
    await executePull(remote, opts);
  });

// --- --remote flag on start and run ---

program.parseAsync().catch((err) => {
  const detail: Record<string, unknown> = { error: err.message };
  if (err.cause) detail.cause = String(err.cause);
  if (err.code) detail.code = err.code;
  if (err.status) detail.status = err.status;
  if (err.stack) detail.stack = err.stack;
  console.error(JSON.stringify(detail));
  process.exit(1);
});
