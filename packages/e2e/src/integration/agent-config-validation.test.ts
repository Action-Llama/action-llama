/**
 * Integration tests: validateAgentConfig and loadAgentBody edge cases — no Docker required.
 *
 * Tests validateAgentConfig() directly (distinct from startup flow tests that
 * test it through startScheduler) and the malformed-frontmatter path in
 * loadAgentBody() not covered by config-file-ops.test.ts.
 *
 * Covers:
 *   - shared/config/validate.ts: validateAgentConfig() — all four success paths
 *     (schedule-only, webhook-only, both, scale=0 bypass) and three error paths
 *     (no triggers, invalid name, scale=0 with invalid name)
 *   - shared/config/load-agent.ts: loadAgentBody() malformed YAML frontmatter
 *     throws ConfigError with file path
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  validateAgentConfig,
  loadAgentBody,
} from "@action-llama/action-llama/internals/config";
import type { AgentConfig } from "@action-llama/action-llama/internals/config";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-agent-val-test-"));
}

/**
 * Minimal AgentConfig builder.
 */
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    credentials: [],
    models: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateAgentConfig
// ---------------------------------------------------------------------------

describe("agent-config-validation: validateAgentConfig", { timeout: 10_000 }, () => {
  it("accepts agent with a schedule", () => {
    expect(() =>
      validateAgentConfig(makeConfig({ schedule: "*/5 * * * *" }))
    ).not.toThrow();
  });

  it("accepts agent with webhooks", () => {
    expect(() =>
      validateAgentConfig(
        makeConfig({ webhooks: [{ source: "github", events: ["issues"] }] }),
      )
    ).not.toThrow();
  });

  it("accepts agent with both schedule and webhooks", () => {
    expect(() =>
      validateAgentConfig(
        makeConfig({
          schedule: "0 9 * * 1",
          webhooks: [{ source: "sentry" }],
        }),
      )
    ).not.toThrow();
  });

  it("accepts agent with scale=0 even without triggers (early return)", () => {
    // scale=0 means the agent is disabled — the scheduler skips the trigger requirement
    expect(() =>
      validateAgentConfig(makeConfig({ scale: 0 }))
    ).not.toThrow();
  });

  it("throws ConfigError when agent has no schedule or webhooks (scale > 0)", () => {
    expect(() =>
      validateAgentConfig(makeConfig())
    ).toThrow(/must have a schedule|schedule.*webhook/i);
  });

  it("throws ConfigError when agent name is invalid (even with scale=0)", () => {
    // Name validation runs BEFORE the scale=0 early return
    expect(() =>
      validateAgentConfig(makeConfig({ name: "INVALID-NAME", scale: 0 }))
    ).toThrow(/invalid|lowercase/i);
  });

  it("throws ConfigError when name ends with hyphen, even with valid triggers", () => {
    expect(() =>
      validateAgentConfig(
        makeConfig({ name: "bad-agent-", schedule: "*/5 * * * *" }),
      )
    ).toThrow(/invalid/i);
  });

  it("accepts agent with webhooks array of length 1 and no schedule", () => {
    // A single webhook entry is sufficient
    expect(() =>
      validateAgentConfig(
        makeConfig({ webhooks: [{ source: "slack" }] }),
      )
    ).not.toThrow();
  });

  it("throws when webhooks array is empty (treated as no webhooks)", () => {
    expect(() =>
      validateAgentConfig(makeConfig({ webhooks: [] }))
    ).toThrow(/must have a schedule|schedule.*webhook/i);
  });
});

// ---------------------------------------------------------------------------
// loadAgentBody — malformed frontmatter
// ---------------------------------------------------------------------------

describe("agent-config-validation: loadAgentBody malformed frontmatter", { timeout: 10_000 }, () => {
  it("throws ConfigError when SKILL.md has malformed YAML frontmatter", () => {
    const dir = makeTempDir();
    const agentDir = join(dir, "agents", "bad-yaml-agent");
    mkdirSync(agentDir, { recursive: true });
    // Malformed YAML inside the frontmatter delimiters
    writeFileSync(
      join(agentDir, "SKILL.md"),
      "---\nname: [unterminated bracket\n---\n\nBody content.\n",
    );

    expect(() => loadAgentBody(dir, "bad-yaml-agent")).toThrow(
      /Error parsing|SKILL\.md/i,
    );
  });

  it("does not throw for valid but minimal frontmatter", () => {
    const dir = makeTempDir();
    const agentDir = join(dir, "agents", "minimal-fm-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "SKILL.md"),
      "---\nname: minimal-fm-agent\n---\n\nHello world.\n",
    );

    const body = loadAgentBody(dir, "minimal-fm-agent");
    expect(body).toContain("Hello world.");
  });
});
