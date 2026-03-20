import { execSync } from "child_process";

export interface HookContext {
  env: Record<string, string>;
  logger: (level: string, msg: string, data?: Record<string, any>) => void;
}

/**
 * Run hook commands sequentially via `/bin/sh -c`.
 * If any command exits non-zero, throws immediately.
 */
export async function runHooks(
  commands: string[],
  phase: "pre" | "post",
  ctx: HookContext,
): Promise<void> {
  ctx.logger("info", `hooks.${phase} starting`, { count: commands.length });

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const label = `[${i + 1}/${commands.length}]`;

    ctx.logger("info", `hooks.${phase} ${label}: ${cmd.slice(0, 200)}`);
    try {
      execSync(cmd, {
        shell: "/bin/sh",
        env: ctx.env as NodeJS.ProcessEnv,
        cwd: "/tmp",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 300_000, // 5 minute max per hook
      });
    } catch (err: any) {
      const stderr = err?.stderr?.toString().trim() || err?.message || String(err);
      ctx.logger("error", `hooks.${phase} ${label} failed`, { error: stderr.slice(0, 500) });
      throw new Error(`Hook ${phase} command failed: ${cmd}\n${stderr}`);
    }
  }

  ctx.logger("info", `hooks.${phase} complete`);
}
