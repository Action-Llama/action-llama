import { mkdirSync } from "fs";
import { resolve } from "path";
import pino from "pino";
import { logsDir } from "./paths.js";

export type LogLevel = "info" | "warn" | "error" | "debug";

export type Logger = pino.Logger;

export function createLogger(projectPath: string, agent: string): Logger {
  const dir = logsDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logFile = resolve(dir, `${agent}-${date}.log`);

  const transport = pino.transport({
    targets: [
      {
        target: "pino-pretty",
        options: {
          destination: 1, // stdout
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "HH:MM:ss",
        },
        level: "debug",
      },
      {
        target: "pino/file",
        options: { destination: logFile, mkdir: true },
        level: "debug",
      },
    ],
  });

  return pino({ name: agent, level: "debug" }, transport);
}

export function createFileOnlyLogger(projectPath: string, agent: string): Logger {
  const dir = logsDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logFile = resolve(dir, `${agent}-${date}.log`);

  const transport = pino.transport({
    targets: [
      {
        target: "pino/file",
        options: { destination: logFile, mkdir: true },
        level: "debug",
      },
    ],
  });

  return pino({ name: agent, level: "debug" }, transport);
}
