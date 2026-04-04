/**
 * Integration tests: cli/commands/chat.ts execute() validation guards — no Docker required.
 *
 * The `al chat --agent <name>` command calls executeAgentChat() which performs
 * one early validation check before attempting to load credentials or start an
 * interactive session:
 *
 *   1. Agent not found — check discoverAgents() for the agent name. If not found,
 *      throw an Error with `Agent "<name>" not found.` plus either:
 *        - "No agents found." when the project has no agents
 *        - "Available agents: ..." when the project has agents
 *
 * These checks throw before any credential loading or network call, so they
 * are testable without Docker or a running scheduler.
 *
 * Test scenarios (no Docker required):
 *   1. Agent not found in project with no agents → throws "Agent ... not found. No agents found."
 *   2. Agent not found in project with agents → throws "Agent ... not found. Available agents: ..."
 *   3. Error is a plain Error (not ConfigError)
 *   4. Error includes the missing agent name
 *   5. Error includes available agent names when agents exist
 *   6. Multiple agents listed in available agents message
 *   7. new.ts execute() with empty name → throws "Project name is required"
 *
 * Covers:
 *   - cli/commands/chat.ts: executeAgentChat() agentNames.includes() false → throw Error
 *   - cli/commands/chat.ts: executeAgentChat() agentNames.length === 0 → "No agents found."
 *   - cli/commands/chat.ts: executeAgentChat() agentNames.length > 0 → "Available agents: ..."
 *   - cli/commands/new.ts: execute() empty name guard → throw Error "Project name is required"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { execute: chatExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/chat.js"
);

const { execute: newExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/new.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

/** Create a minimal valid project directory with config.toml. */
function setupProject(projectDir: string): void {
  writeFileSync(
    join(projectDir, "config.toml"),
    '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\nauthType = "api_key"\n'
  );
}

/** Create a valid agent directory inside the project. */
function setupAgent(projectDir: string, agentName: string): void {
  const agentDir = join(projectDir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "SKILL.md"),
    `---\ndescription: "${agentName} agent"\n---\n\n# ${agentName} Agent\n\nTest agent.\n`
  );
  writeFileSync(
    join(agentDir, "config.toml"),
    'models = ["sonnet"]\nschedule = "0 0 31 2 *"\n'
  );
}

describe(
  "integration: cli/commands/chat.ts and new.ts validation guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-chat-guard-"));
      setupProject(projectDir);
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── Agent not found — no agents in project ──────────────────────────────

    it("throws Error when agent not found and project has no agents", async () => {
      await expect(
        chatExecute({ project: projectDir, agent: "nonexistent-agent" })
      ).rejects.toThrow("not found");
    });

    it("error message includes 'No agents found' when project has no agents", async () => {
      let caughtError: Error | undefined;
      try {
        await chatExecute({ project: projectDir, agent: "missing-agent" });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("No agents found");
    });

    it("error message includes the missing agent name", async () => {
      const missingName = "my-missing-agent";

      let caughtError: Error | undefined;
      try {
        await chatExecute({ project: projectDir, agent: missingName });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain(missingName);
    });

    it("throws a plain Error (not ConfigError) for agent not found", async () => {
      let caught: unknown;
      try {
        await chatExecute({ project: projectDir, agent: "nonexistent" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught instanceof Error).toBe(true);
      expect(caught instanceof ConfigError).toBe(false);
    });

    // ── Agent not found — project has agents ────────────────────────────────

    it("throws Error when agent name not found but project has agents", async () => {
      setupAgent(projectDir, "real-agent");

      await expect(
        chatExecute({ project: projectDir, agent: "nonexistent-agent" })
      ).rejects.toThrow("not found");
    });

    it("error message includes 'Available agents:' when project has agents", async () => {
      setupAgent(projectDir, "my-agent");

      let caughtError: Error | undefined;
      try {
        await chatExecute({ project: projectDir, agent: "wrong-name" });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("Available agents:");
    });

    it("error message lists available agent names", async () => {
      setupAgent(projectDir, "alpha-agent");

      let caughtError: Error | undefined;
      try {
        await chatExecute({ project: projectDir, agent: "beta-agent" });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("alpha-agent");
    });

    it("error message lists all available agents when multiple exist", async () => {
      setupAgent(projectDir, "agent-one");
      setupAgent(projectDir, "agent-two");

      let caughtError: Error | undefined;
      try {
        await chatExecute({ project: projectDir, agent: "agent-three" });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("agent-one");
      expect(caughtError!.message).toContain("agent-two");
    });

    it("error includes both the missing name and 'not found' phrase", async () => {
      setupAgent(projectDir, "existing-agent");

      let caughtError: Error | undefined;
      try {
        await chatExecute({ project: projectDir, agent: "missing-chat-agent" });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("missing-chat-agent");
      expect(caughtError!.message).toContain("not found");
    });

    // ── cli/commands/new.ts empty name guard ────────────────────────────────

    it("new.ts throws Error for empty name", async () => {
      await expect(newExecute("", {})).rejects.toThrow("Project name is required");
    });

    it("new.ts error for empty name is a plain Error", async () => {
      let caught: unknown;
      try {
        await newExecute("", {});
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught instanceof Error).toBe(true);
      // Verify it's a plain Error (the guard uses `throw new Error`, not ConfigError)
      expect((caught as Error).constructor.name).toBe("Error");
    });
  },
);
