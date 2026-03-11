import { parseCredentialRef, loadCredentialField } from "../shared/credentials.js";
import type { Logger } from "../shared/logger.js";

const GIT_ENV_KEYS = [
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_NAME", 
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_EMAIL",
] as const;

export interface SavedEnv {
  [key: string]: string | undefined;
}

export class GitEnvironment {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Sets up git environment variables from credentials
   * Returns the previous values so they can be restored later
   */
  async setup(credentials: string[]): Promise<SavedEnv> {
    // Save current git env vars so they can be restored later
    const savedGitEnv: SavedEnv = {};
    for (const key of GIT_ENV_KEYS) {
      savedGitEnv[key] = process.env[key];
    }

    // Set git author identity from git_ssh credential (scoped to this run)
    const gitSshRef = credentials.find((ref) => parseCredentialRef(ref).type === "git_ssh");
    if (gitSshRef) {
      const { instance } = parseCredentialRef(gitSshRef);
      try {
        const gitName = await loadCredentialField("git_ssh", instance, "username");
        if (gitName) {
          process.env.GIT_AUTHOR_NAME = gitName;
          process.env.GIT_COMMITTER_NAME = gitName;
          this.logger.debug({ gitName }, "Set git author name from credential");
        }
        const gitEmail = await loadCredentialField("git_ssh", instance, "email");
        if (gitEmail) {
          process.env.GIT_AUTHOR_EMAIL = gitEmail;
          process.env.GIT_COMMITTER_EMAIL = gitEmail;
          this.logger.debug({ gitEmail }, "Set git author email from credential");
        }
      } catch (err) {
        this.logger.warn({ err, gitSshRef }, "Failed to load git SSH credential");
      }
    }

    return savedGitEnv;
  }

  /**
   * Restores git environment variables to their previous values
   */
  restore(saved: SavedEnv): void {
    // Restore the git env vars we may have overwritten so other
    // agents running in the same process get a clean slate.
    for (const key of GIT_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}