import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { NETWORK_NAME } from "./network.js";

export interface ContainerOptions {
  image: string;
  agentName: string;
  agentConfig: string;
  shutdownSecret: string;
  gatewayUrl: string;
  prompt: string;
  credentialsStagingDir: string;
  memory?: string;
  cpus?: number;
  timeout?: number;
}

function docker(...args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

export function launchContainer(opts: ContainerOptions): string {
  const runId = randomUUID().slice(0, 8);
  const containerName = `al-${opts.agentName}-${runId}`;
  const memory = opts.memory || "4g";
  const cpus = opts.cpus || 2;

  const args = [
    "run", "-d",
    "--name", containerName,
    "--network", NETWORK_NAME,
    "--user", "1000:1000",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,uid=1000,gid=1000,size=512m",
    "--tmpfs", "/workspace:rw,exec,nosuid,uid=1000,gid=1000,size=2g",
    "--tmpfs", "/home/node:rw,nosuid,uid=1000,gid=1000,size=64m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", "256",
    "--memory", memory,
    "--cpus", String(cpus),
    "-v", `${opts.credentialsStagingDir}:/credentials:ro`,
    "-e", `GATEWAY_URL=${opts.gatewayUrl}`,
    "-e", `SHUTDOWN_SECRET=${opts.shutdownSecret}`,
    "-e", `AGENT_CONFIG=${opts.agentConfig}`,
    "-e", `PROMPT=${opts.prompt}`,
    opts.image,
  ];

  docker(...args);

  return containerName;
}

export function waitForContainer(containerName: string, timeoutSeconds?: number): { exitCode: number } {
  const timeout = timeoutSeconds || 3600;
  try {
    const result = execFileSync("docker", ["wait", containerName], {
      encoding: "utf-8",
      timeout: timeout * 1000,
    }).trim();
    return { exitCode: parseInt(result, 10) };
  } catch (err: any) {
    // Timeout — kill the container
    try {
      docker("kill", containerName);
    } catch { /* already dead */ }
    throw new Error(`Container ${containerName} timed out after ${timeout}s`);
  }
}

export function getContainerLogs(containerName: string): string {
  try {
    return docker("logs", containerName);
  } catch {
    return "";
  }
}

export function removeContainer(containerName: string): void {
  try {
    docker("rm", "-f", containerName);
  } catch {
    // Container may already be removed
  }
}
