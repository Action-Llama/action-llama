import { execSync } from "child_process";

/**
 * Process `!\`command\`` expressions in a SKILL.md body.
 * Executes each command and replaces the expression with stdout.
 * On failure, replaces with `[Error: <message>]`.
 */
export function processContextInjection(
  body: string,
  env: Record<string, string>,
): string {
  // Match !`command` — the ! must be at position 0 or preceded by whitespace/newline
  return body.replace(/!\`([^`]+)\`/g, (_match, command: string) => {
    try {
      const result = execSync(command, {
        shell: "/bin/sh",
        env: env as NodeJS.ProcessEnv,
        cwd: "/tmp",
        timeout: 60_000, // 1 minute max per injection
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.trimEnd();
    } catch (err: any) {
      const stderr = err?.stderr?.toString().trim() || err?.message || String(err);
      return `[Error: ${stderr.slice(0, 500)}]`;
    }
  });
}
