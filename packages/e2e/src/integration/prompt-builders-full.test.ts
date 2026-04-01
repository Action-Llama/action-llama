/**
 * Integration tests: prompt-building functions in full-prompt mode — no Docker required.
 *
 * When ctx.useBakedImages=false, the make* functions build full prompts that
 * include the agent config block, credential context, environment context, and
 * skill blocks. This path exercises agents/prompt.ts: buildPromptSkeleton(),
 * buildConfigBlock(), buildCredentialContext(), buildSkillsBlock().
 *
 * Tests verify the structure of the full prompt without asserting exact strings
 * (which would be brittle to upstream changes).
 *
 * Covers:
 *   - execution/execution.ts: makeScheduledPrompt(), makeManualPrompt(),
 *     makeWebhookPrompt(), makeTriggeredPrompt() — useBakedImages=false branches
 *   - agents/prompt.ts: buildPromptSkeleton(), buildScheduledPrompt(),
 *     buildManualPrompt(), buildCredentialContext(), buildSkillsBlock()
 */

import { describe, it, expect } from "vitest";
import {
  makeScheduledPrompt,
  makeManualPrompt,
  makeWebhookPrompt,
  makeTriggeredPrompt,
} from "@action-llama/action-llama/internals/execution";
import type { SchedulerContext } from "@action-llama/action-llama/internals/execution";
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

/**
 * Minimal SchedulerContext for useBakedImages=false tests.
 */
function makeFullCtx(skills = {}): SchedulerContext {
  return {
    useBakedImages: false,
    skills,
    runnerPools: {},
    agentConfigs: [],
    maxReruns: 10,
    maxTriggerDepth: 3,
    logger: console as any,
    workQueue: {} as any,
    shuttingDown: false,
  };
}

/**
 * Minimal AgentConfig for testing.
 */
function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    credentials: ["anthropic_key", "github_token"],
    models: [],
    ...overrides,
  };
}

describe("prompt-builders-full: makeScheduledPrompt (useBakedImages=false)", { timeout: 10_000 }, () => {
  it("returns a full prompt containing agent-config block", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeFullCtx());
    expect(prompt).toContain("<agent-config>");
    expect(prompt).toContain("</agent-config>");
  });

  it("contains credential context block", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeFullCtx());
    expect(prompt).toContain("<credential-context>");
    expect(prompt).toContain("</credential-context>");
  });

  it("contains environment context block", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeFullCtx());
    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("</environment>");
  });

  it("contains schedule trigger suffix", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeFullCtx());
    expect(prompt.toLowerCase()).toContain("schedule");
  });

  it("includes locking skill block when skills.locking is true", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeFullCtx({ locking: true }));
    expect(prompt).toContain("<skill-lock>");
    expect(prompt).toContain("rlock");
  });

  it("does not include lock skill block when skills.locking is false", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeFullCtx({ locking: false }));
    expect(prompt).not.toContain("<skill-lock>");
  });
});

describe("prompt-builders-full: makeManualPrompt (useBakedImages=false)", { timeout: 10_000 }, () => {
  it("returns a full prompt with agent-config and manual suffix", () => {
    const prompt = makeManualPrompt(makeAgent(), makeFullCtx());
    expect(prompt).toContain("<agent-config>");
    expect(prompt.toLowerCase()).toContain("manual");
  });

  it("includes user prompt when provided", () => {
    const prompt = makeManualPrompt(makeAgent(), makeFullCtx(), "fix the bug");
    expect(prompt).toContain("<user-prompt>");
    expect(prompt).toContain("fix the bug");
  });
});

describe("prompt-builders-full: makeWebhookPrompt (useBakedImages=false)", { timeout: 10_000 }, () => {
  it("returns full prompt with agent-config and webhook trigger", () => {
    const ctx = {
      source: "github",
      event: "issues",
      action: "opened",
      payload: { title: "Fix bug" },
      receiptId: "rec-1",
    };
    const prompt = makeWebhookPrompt(makeAgent(), ctx as any, makeFullCtx());
    expect(prompt).toContain("<agent-config>");
    expect(prompt).toContain("<webhook-trigger>");
    expect(prompt).toContain("github");
  });
});

describe("prompt-builders-full: makeTriggeredPrompt (useBakedImages=false)", { timeout: 10_000 }, () => {
  it("returns full prompt with agent-config and agent-call block", () => {
    const prompt = makeTriggeredPrompt(makeAgent(), "orchestrator", "check the queue", makeFullCtx());
    expect(prompt).toContain("<agent-config>");
    expect(prompt).toContain("<agent-call>");
    expect(prompt).toContain("orchestrator");
  });
});
