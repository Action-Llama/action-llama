/**
 * Integration tests: agents/prompt.ts buildPromptSkeleton() with skills
 * — no Docker required.
 *
 * The existing prompt-builder tests exercise buildPromptSkeleton() but don't
 * cover the hostUser=true environment context branch or the subagents skill
 * block through buildPromptSkeleton(). This test fills those gaps.
 *
 * Uncovered branches in agents/prompt.ts:
 *
 * buildEnvironmentContext({ hostUser: true }):
 *   - Returns different text than the default (Docker) environment context
 *   - Mentions "Your working directory is your current CWD" (not /app/static)
 *   - Does NOT mention "/app/static" (that's the Docker path)
 *   - Accessed via buildPromptSkeleton(agentConfig, { hostUser: true })
 *
 * buildSkillsBlock({ subagents: true, availableAgents: [...] }):
 *   - Returns subagent skill block when skills.subagents = true
 *   - Returns combined locking+subagent blocks when both are true
 *   - Accessed via buildPromptSkeleton(agentConfig, skills)
 *
 * buildConfigBlock() agentConfig.params path:
 *   - When params are defined, they appear in the config block
 *
 * Covers:
 *   - agents/prompt.ts: buildEnvironmentContext() hostUser=true branch
 *   - agents/prompt.ts: buildSkillsBlock() subagents=true branch
 *   - agents/prompt.ts: buildSkillsBlock() locking+subagents combined
 *   - agents/prompt.ts: buildPromptSkeleton() passes hostUser to buildEnvironmentContext
 *   - agents/prompt.ts: buildPromptSkeleton() passes skills to buildSkillsBlock
 */

import { describe, it, expect } from "vitest";
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

const {
  buildPromptSkeleton,
  buildScheduledSuffix,
  buildManualSuffix,
  buildUserPromptSuffix,
  buildCalledSuffix,
  buildWebhookSuffix,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/prompt.js"
);

/** Create a minimal AgentConfig for testing. */
function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: "test-agent",
    description: "A test agent",
    credentials: [],
    models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
    params: {},
    ...overrides,
  };
}

describe(
  "integration: agents/prompt.ts buildPromptSkeleton() skills branches (no Docker required)",
  { timeout: 10_000 },
  () => {
    const agentConfig = makeAgentConfig();

    // ── buildEnvironmentContext() hostUser=true branch ────────────────────────

    it("hostUser=true environment context mentions 'Your working directory is your current CWD'", () => {
      const result = buildPromptSkeleton(agentConfig, { hostUser: true });
      expect(result).toContain("Your working directory is your current CWD");
    });

    it("hostUser=true environment context does NOT mention '/app/static'", () => {
      const result = buildPromptSkeleton(agentConfig, { hostUser: true });
      // /app/static is the Docker-only path — not present in host-user mode
      expect(result).not.toContain("/app/static");
    });

    it("hostUser=true environment context mentions filesystem is writable", () => {
      const result = buildPromptSkeleton(agentConfig, { hostUser: true });
      expect(result).toContain("writable");
    });

    it("default (no hostUser) environment context mentions '/app/static'", () => {
      // Default (Docker) environment context
      const result = buildPromptSkeleton(agentConfig);
      expect(result).toContain("/app/static");
    });

    it("default (no hostUser) environment context mentions read-only root filesystem", () => {
      const result = buildPromptSkeleton(agentConfig);
      expect(result).toContain("read-only");
    });

    it("hostUser=false behaves same as no hostUser (Docker environment)", () => {
      const result = buildPromptSkeleton(agentConfig, { hostUser: false });
      expect(result).toContain("/app/static");
      expect(result).not.toContain("Your working directory is your current CWD");
    });

    // ── buildSkillsBlock() subagents=true branch ──────────────────────────────

    it("subagents=true includes al-subagent skill block in skeleton", () => {
      const result = buildPromptSkeleton(agentConfig, { subagents: true });
      expect(result).toContain("al-subagent");
    });

    it("subagents=true with availableAgents lists agent names in skeleton", () => {
      const result = buildPromptSkeleton(agentConfig, {
        subagents: true,
        availableAgents: [
          { name: "code-reviewer", description: "Reviews PRs" },
          { name: "deployer", description: "Deploys to production" },
        ],
      });
      expect(result).toContain("code-reviewer");
      expect(result).toContain("deployer");
    });

    it("subagents=true with no available agents omits agent list but includes skill block", () => {
      const result = buildPromptSkeleton(agentConfig, { subagents: true });
      expect(result).toContain("al-subagent");
      // No agent list header when availableAgents is not provided
      expect(result).not.toContain("Available Agents:");
    });

    // ── buildSkillsBlock() locking + subagents combined ───────────────────────

    it("locking=true AND subagents=true → both skill blocks present", () => {
      const result = buildPromptSkeleton(agentConfig, { locking: true, subagents: true });
      // Locking skill
      expect(result).toContain("rlock");
      // Subagent skill
      expect(result).toContain("al-subagent");
    });

    it("locking=true AND subagents=true → skill blocks appear after environment block", () => {
      const result = buildPromptSkeleton(agentConfig, { locking: true, subagents: true });
      const envIdx = result.indexOf("<environment>");
      const lockIdx = result.indexOf("rlock");
      const agentIdx = result.indexOf("al-subagent");
      expect(envIdx).toBeGreaterThan(-1);
      expect(lockIdx).toBeGreaterThan(envIdx);
      expect(agentIdx).toBeGreaterThan(envIdx);
    });

    it("no skills → no skill blocks in skeleton", () => {
      const result = buildPromptSkeleton(agentConfig);
      expect(result).not.toContain("rlock");
      expect(result).not.toContain("al-subagent");
    });

    // ── buildPromptSkeleton with hostUser + subagents ─────────────────────────

    it("hostUser=true + subagents=true → correct environment + skill block", () => {
      const result = buildPromptSkeleton(agentConfig, {
        hostUser: true,
        subagents: true,
        availableAgents: [{ name: "helper", description: "A helper agent" }],
      });
      // hostUser environment
      expect(result).toContain("Your working directory is your current CWD");
      // subagent skill
      expect(result).toContain("al-subagent");
      expect(result).toContain("helper");
    });

    // ── Suffix functions (smoke tests) ────────────────────────────────────────

    it("buildScheduledSuffix returns non-empty string about schedule", () => {
      const result = buildScheduledSuffix();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      expect(result).toMatch(/schedule/i);
    });

    it("buildManualSuffix returns non-empty string about manual trigger", () => {
      const result = buildManualSuffix();
      expect(typeof result).toBe("string");
      expect(result).toMatch(/manual/i);
    });

    it("buildUserPromptSuffix wraps prompt in user-prompt tags", () => {
      const result = buildUserPromptSuffix("Do the thing.");
      expect(result).toContain("<user-prompt>");
      expect(result).toContain("Do the thing.");
      expect(result).toContain("</user-prompt>");
    });

    it("buildCalledSuffix wraps context in agent-call tags with caller name", () => {
      const result = buildCalledSuffix("orchestrator", "fix bug #123");
      expect(result).toContain("<agent-call>");
      expect(result).toContain("orchestrator");
      expect(result).toContain("fix bug #123");
    });

    it("buildWebhookSuffix wraps context in webhook-trigger tags", () => {
      const result = buildWebhookSuffix({ source: "github", event: "push", body: "{}" });
      expect(result).toContain("<webhook-trigger>");
      expect(result).toContain("github");
      expect(result).toContain("push");
    });
  },
);
