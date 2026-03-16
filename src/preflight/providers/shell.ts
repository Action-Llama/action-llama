import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { PreflightProvider, PreflightContext } from "../schema.js";
import { interpolateString, interpolateParams } from "../interpolate.js";

export const shellProvider: PreflightProvider = {
  id: "shell",

  async run(params: Record<string, unknown>, ctx: PreflightContext): Promise<void> {
    const resolved = interpolateParams(params, ctx.env);
    const command = resolved.command;
    if (typeof command !== "string" || !command) {
      throw new Error("shell provider requires a 'command' param");
    }
    const output = typeof resolved.output === "string" ? resolved.output : undefined;

    ctx.logger("info", "preflight shell", { command: command.slice(0, 200) });

    const stdout = execSync(command, {
      shell: "/bin/sh",
      env: ctx.env,
      stdio: output ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    });

    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, stdout);
      ctx.logger("info", "preflight shell output written", { path: output, bytes: stdout.length });
    }
  },
};
