import { execSync } from "child_process";
import type { PreflightProvider, PreflightContext } from "../schema.js";
import { interpolateParams } from "../interpolate.js";

export const gitCloneProvider: PreflightProvider = {
  id: "git-clone",

  async run(params: Record<string, unknown>, ctx: PreflightContext): Promise<void> {
    const resolved = interpolateParams(params, ctx.env);
    const repo = resolved.repo;
    if (typeof repo !== "string" || !repo) {
      throw new Error("git-clone provider requires a 'repo' param");
    }
    const dest = resolved.dest;
    if (typeof dest !== "string" || !dest) {
      throw new Error("git-clone provider requires a 'dest' param");
    }

    // Expand short "owner/repo" to SSH URL; full URLs pass through
    const repoUrl = repo.includes("://") || repo.startsWith("git@")
      ? repo
      : `git@github.com:${repo}.git`;

    const args = ["git", "clone"];
    if (typeof resolved.branch === "string" && resolved.branch) {
      args.push("--branch", resolved.branch);
    }
    if (typeof resolved.depth === "number" && resolved.depth > 0) {
      args.push("--depth", String(resolved.depth));
    }
    args.push(repoUrl, dest);

    const cmd = args.join(" ");
    ctx.logger("info", "preflight git-clone", { repo: repoUrl, dest });

    execSync(cmd, {
      env: ctx.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    ctx.logger("info", "preflight git-clone done", { dest });
  },
};
