/**
 * Integration tests: prompt-building functions — no Docker required.
 *
 * makeScheduledPrompt(), makeWebhookPrompt(), makeManualPrompt(), and
 * makeTriggeredPrompt() are exported from the execution module and
 * called by the scheduler to build container prompts.
 *
 * When ctx.useBakedImages=true (the normal production path), each function
 * delegates to a corresponding buildXxxSuffix() helper that returns a short
 * directive string injected into the container as PROMPT env var.
 *
 * All tests run without Docker or scheduler startup.
 *
 * Covers:
 *   - execution/execution.ts: makeScheduledPrompt(), makeWebhookPrompt(),
 *     makeManualPrompt() (with and without user prompt), makeTriggeredPrompt()
 *     — the useBakedImages=true branches
 *   - agents/prompt.ts: buildScheduledSuffix(), buildManualSuffix(),
 *     buildUserPromptSuffix(), buildCalledSuffix(), buildWebhookSuffix()
 *     — exercised indirectly via the make* functions
 */

import { describe, it, expect } from "vitest";
import {
  makeScheduledPrompt,
  makeWebhookPrompt,
  makeManualPrompt,
  makeTriggeredPrompt,
} from "@action-llama/action-llama/internals/execution";
import type { SchedulerContext } from "@action-llama/action-llama/internals/execution";
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

/**
 * Minimal SchedulerContext for useBakedImages=true tests.
 * Only useBakedImages matters for these code paths; other fields are unused.
 */
function makeBakedCtx(): SchedulerContext {
  return {
    useBakedImages: true,
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
function makeAgent(name = "test-agent"): AgentConfig {
  return {
    name,
    credentials: [],
    models: [],
  };
}

describe("prompt-builders: makeScheduledPrompt (useBakedImages=true)", { timeout: 10_000 }, () => {
  it("returns a non-empty string", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeBakedCtx());
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("contains 'schedule' to indicate the trigger type", () => {
    const prompt = makeScheduledPrompt(makeAgent(), makeBakedCtx());
    expect(prompt.toLowerCase()).toContain("schedule");
  });

  it("does not contain the agent name (baked suffix is trigger-only)", () => {
    const prompt = makeScheduledPrompt(makeAgent("my-special-agent"), makeBakedCtx());
    // In baked-images mode, the full prompt (with agent name) is NOT included
    expect(prompt).not.toContain("my-special-agent");
  });
});

describe("prompt-builders: makeManualPrompt (useBakedImages=true)", { timeout: 10_000 }, () => {
  it("returns manual trigger message when no user prompt", () => {
    const prompt = makeManualPrompt(makeAgent(), makeBakedCtx());
    expect(prompt.toLowerCase()).toContain("manual");
  });

  it("wraps user prompt in <user-prompt> tags when prompt is provided", () => {
    const prompt = makeManualPrompt(makeAgent(), makeBakedCtx(), "analyze the repo");
    expect(prompt).toContain("<user-prompt>");
    expect(prompt).toContain("analyze the repo");
    expect(prompt).toContain("</user-prompt>");
  });

  it("different output for manual vs user-prompt variants", () => {
    const manual = makeManualPrompt(makeAgent(), makeBakedCtx());
    const userPrompt = makeManualPrompt(makeAgent(), makeBakedCtx(), "do something");
    expect(manual).not.toBe(userPrompt);
  });
});

describe("prompt-builders: makeWebhookPrompt (useBakedImages=true)", { timeout: 10_000 }, () => {
  it("returns a non-empty string", () => {
    const ctx = {
      source: "github",
      event: "issues",
      action: "opened",
      payload: { title: "test issue" },
      receiptId: "rec-1",
    };
    const prompt = makeWebhookPrompt(makeAgent(), ctx as any, makeBakedCtx());
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("embeds the webhook context in the prompt", () => {
    const ctx = {
      source: "github",
      event: "issues",
      action: "opened",
      payload: {},
      receiptId: "rec-2",
    };
    const prompt = makeWebhookPrompt(makeAgent(), ctx as any, makeBakedCtx());
    // The context should be JSON-embedded
    expect(prompt).toContain("github");
    expect(prompt).toContain("<webhook-trigger>");
  });

  it("wraps context in webhook-trigger XML block", () => {
    const ctx = { source: "sentry", event: "event_alert", payload: {}, receiptId: "r3" };
    const prompt = makeWebhookPrompt(makeAgent(), ctx as any, makeBakedCtx());
    expect(prompt).toContain("<webhook-trigger>");
    expect(prompt).toContain("</webhook-trigger>");
    expect(prompt).toContain("sentry");
  });
});

describe("prompt-builders: makeTriggeredPrompt (useBakedImages=true)", { timeout: 10_000 }, () => {
  it("returns a non-empty string", () => {
    const prompt = makeTriggeredPrompt(makeAgent(), "caller-agent", "do some work", makeBakedCtx());
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes the caller agent name", () => {
    const prompt = makeTriggeredPrompt(makeAgent(), "orchestrator", "check the PR", makeBakedCtx());
    expect(prompt).toContain("orchestrator");
  });

  it("includes the context passed by the caller", () => {
    const prompt = makeTriggeredPrompt(makeAgent(), "caller", "analyze file X", makeBakedCtx());
    expect(prompt).toContain("analyze file X");
  });

  it("wraps call info in agent-call XML block", () => {
    const prompt = makeTriggeredPrompt(makeAgent(), "caller", "context", makeBakedCtx());
    expect(prompt).toContain("<agent-call>");
    expect(prompt).toContain("</agent-call>");
  });
});
