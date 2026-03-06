import { execFileSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import { NETWORK_NAME } from "./network.js";
import type { ContainerRuntime, RuntimeLaunchOpts } from "./runtime.js";

function docker(...args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

export class LocalDockerRuntime implements ContainerRuntime {
  async launch(opts: RuntimeLaunchOpts): Promise<string> {
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
      "--tmpfs", "/tmp:rw,exec,nosuid,uid=1000,gid=1000,size=512m",
      "--tmpfs", "/workspace:rw,exec,nosuid,uid=1000,gid=1000,size=2g",
      "--tmpfs", "/home/node:rw,nosuid,uid=1000,gid=1000,size=64m",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--pids-limit", "256",
      "--memory", memory,
      "--cpus", String(cpus),
    ];

    if (opts.credentialsStagingDir) {
      args.push("-v", `${opts.credentialsStagingDir}:/credentials:ro`);
    }

    for (const [key, value] of Object.entries(opts.env)) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(opts.image);

    docker(...args);

    return containerName;
  }

  streamLogs(
    containerName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void } {
    const proc = spawn("docker", ["logs", "-f", containerName], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        onLine(line);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && onStderr) {
        onStderr(text);
      }
    });

    return {
      stop: () => {
        if (buffer.trim()) {
          onLine(buffer);
        }
        proc.kill();
      },
    };
  }

  waitForExit(containerName: string, timeoutSeconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", ["wait", containerName], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        spawn("docker", ["kill", containerName], { stdio: "ignore" });
        reject(new Error(`Container ${containerName} timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);

      proc.on("close", () => {
        clearTimeout(timer);
        resolve(parseInt(stdout.trim(), 10));
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async kill(containerName: string): Promise<void> {
    try {
      docker("kill", containerName);
    } catch {
      // Container may already be dead
    }
  }

  async remove(containerName: string): Promise<void> {
    try {
      docker("rm", "-f", containerName);
    } catch {
      // Container may already be removed
    }
  }
}
