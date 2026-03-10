import { resolve } from "path";
import { createReadStream, readdirSync, existsSync, statSync } from "fs";
import { createInterface } from "readline";
import { logsDir } from "../../shared/paths.js";
import { loadGlobalConfig, loadAgentConfig } from "../../shared/config.js";
import { AWS_CONSTANTS } from "../../shared/aws-constants.js";

const LEVEL_COLORS: Record<number, { label: string; color: string }> = {
  10: { label: "TRACE", color: "\x1b[90m" },   // gray
  20: { label: "DEBUG", color: "\x1b[36m" },   // cyan
  30: { label: "INFO",  color: "\x1b[32m" },   // green
  40: { label: "WARN",  color: "\x1b[33m" },   // yellow
  50: { label: "ERROR", color: "\x1b[31m" },   // red
};
const RESET = "\x1b[0m";

interface LogEntry {
  level: number;
  time: number;
  msg: string;
  name?: string;
  pid?: number;
  hostname?: string;
  [key: string]: unknown;
}

function formatEntry(entry: LogEntry): string {
  const date = new Date(entry.time);
  const time = date.toLocaleTimeString("en-US", { hour12: false });
  const levelInfo = LEVEL_COLORS[entry.level] || { label: `L${entry.level}`, color: "" };

  // Collect extra fields (exclude standard pino fields)
  const { level, time: _t, msg, name: _n, pid: _p, hostname: _h, ...extra } = entry;
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";

  return `${levelInfo.color}${time} ${levelInfo.label.padEnd(5)} ${msg}${extraStr}${RESET}`;
}

function parseLine(line: string): LogEntry | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

function findLogFile(dir: string, agent: string, date?: string): string | null {
  if (date) {
    const file = resolve(dir, `${agent}-${date}.log`);
    return existsSync(file) ? file : null;
  }

  // Default to today
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = resolve(dir, `${agent}-${today}.log`);
  if (existsSync(todayFile)) return todayFile;

  // Find most recent log file for this agent
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`${agent}-`) && f.endsWith(".log"))
    .sort()
    .reverse();

  return files.length > 0 ? resolve(dir, files[0]) : null;
}

async function readLastN(filePath: string, n: number): Promise<void> {
  const entries: string[] = [];

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const entry = parseLine(line);
    if (entry) {
      entries.push(formatEntry(entry));
      if (entries.length > n) entries.shift();
    }
  }

  for (const formatted of entries) {
    console.log(formatted);
  }
}

async function readNewData(filePath: string, start: number): Promise<{ newPosition: number }> {
  const currentSize = statSync(filePath).size;
  if (currentSize <= start) return { newPosition: start };

  const stream = createReadStream(filePath, { encoding: "utf-8", start });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const entry = parseLine(line);
    if (entry) {
      console.log(formatEntry(entry));
    }
  }

  return { newPosition: currentSize };
}

async function followFile(filePath: string, lastN: number): Promise<void> {
  // Print last N entries first
  await readLastN(filePath, lastN);

  // Start tailing from end of file
  let position = statSync(filePath).size;

  // Poll for new data every 500ms (more reliable than fs.watch)
  const interval = setInterval(async () => {
    try {
      const { newPosition } = await readNewData(filePath, position);
      position = newPosition;
    } catch {
      // File may have been rotated or removed — ignore
    }
  }, 500);

  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });

  await new Promise(() => {});
}

export async function execute(
  agent: string,
  opts: { project: string; lines: string; follow?: boolean; date?: string; cloud?: boolean }
): Promise<void> {
  const projectPath = resolve(opts.project);

  if (opts.cloud) {
    const globalConfig = loadGlobalConfig(projectPath);
    const cloud = globalConfig.cloud;
    if (!cloud) {
      throw new Error("No [cloud] section found in config.toml. Run 'al cloud setup' first.");
    }

    const limit = parseInt(opts.lines, 10) || 50;

    let runtime: import("../../docker/runtime.js").ContainerRuntime;
    if (cloud.provider === "cloud-run") {
      const { CloudRunJobRuntime } = await import("../../docker/cloud-run-runtime.js");
      runtime = new CloudRunJobRuntime(cloud as any);
    } else {
      // Route to Lambda runtime for short-timeout agents (same logic as scheduler)
      let effectiveTimeout = globalConfig.local?.timeout ?? 900;
      try {
        const agentConfig = loadAgentConfig(projectPath, agent);
        effectiveTimeout = agentConfig.timeout ?? effectiveTimeout;
      } catch {
        // Agent config not found — fall back to default timeout
      }

      if (effectiveTimeout <= AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT) {
        const { LambdaRuntime } = await import("../../docker/lambda-runtime.js");
        runtime = new LambdaRuntime({
          awsRegion: cloud.awsRegion!,
          ecrRepository: cloud.ecrRepository!,
          secretPrefix: cloud.awsSecretPrefix,
          buildBucket: cloud.buildBucket,
          lambdaRoleArn: cloud.lambdaRoleArn,
          lambdaSubnets: cloud.lambdaSubnets,
          lambdaSecurityGroups: cloud.lambdaSecurityGroups,
        });
      } else {
        const { ECSFargateRuntime } = await import("../../docker/ecs-runtime.js");
        runtime = new ECSFargateRuntime({
          awsRegion: cloud.awsRegion!,
          ecsCluster: cloud.ecsCluster!,
          ecrRepository: cloud.ecrRepository!,
          executionRoleArn: cloud.executionRoleArn!,
          taskRoleArn: cloud.taskRoleArn!,
          subnets: cloud.subnets!,
          securityGroups: cloud.securityGroups,
          secretPrefix: cloud.awsSecretPrefix,
        });
      }
    }

    if (opts.follow) {
      // Find running agent container to follow
      console.log(`Looking for running ${agent} agent...`);
      const runningAgents = await runtime.listRunningAgents();
      const targetAgent = runningAgents.find(a => a.agentName === agent);
      
      if (!targetAgent) {
        console.error(`No running agent found for "${agent}". Start the agent first to follow its logs.`);
        process.exit(1);
      }

      console.log(`Following logs for ${agent} (${targetAgent.taskId})...`);
      
      // Show last N entries first
      const recentLines = await runtime.fetchLogs(agent, limit);
      for (const line of recentLines) {
        console.log(line);
      }

      // Start following new logs
      const { stop } = runtime.streamLogs(
        targetAgent.taskId,
        (line: string) => console.log(line),
        (stderr: string) => console.error(stderr)
      );

      // Handle Ctrl+C to stop following
      process.on("SIGINT", () => {
        console.log("\nStopping log follow...");
        stop();
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {});
    } else {
      // Static log fetch (original behavior)
      console.log(`Fetching cloud logs for ${agent}...`);
      const lines = await runtime.fetchLogs(agent, limit);

      if (lines.length === 0) {
        console.log("No log events found.");
      } else {
        for (const line of lines) {
          console.log(line);
        }
      }
    }
    return;
  }

  const dir = logsDir(projectPath);
  const n = parseInt(opts.lines, 10);

  const logFile = findLogFile(dir, agent, opts.date);

  if (!logFile) {
    const dateStr = opts.date || "today";
    console.error(`No log file found for agent "${agent}" (${dateStr}) in ${dir}`);
    process.exit(1);
  }

  if (opts.follow) {
    await followFile(logFile, n);
  } else {
    await readLastN(logFile, n);
  }
}
