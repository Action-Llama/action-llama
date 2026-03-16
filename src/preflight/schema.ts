/**
 * Preflight step types and provider interface.
 *
 * Preflight steps run mechanical data-staging tasks (clone repos, fetch URLs,
 * run shell commands) inside the container after credentials are loaded but
 * before the LLM session starts. ACTIONS.md references the staged files.
 */

export interface PreflightStep {
  provider: string;              // "git-clone", "http", "shell"
  required?: boolean;            // default true — if a required step fails, the agent aborts
  params: Record<string, unknown>;
}

export interface PreflightContext {
  env: Record<string, string>;   // process.env snapshot (creds already injected)
  logger: (level: string, msg: string, data?: Record<string, any>) => void;
}

export interface PreflightProvider {
  id: string;
  run(params: Record<string, unknown>, ctx: PreflightContext): Promise<void>;
}
