/**
 * Integration tests: execution module constants and loadAgentConfig webhooks — no Docker.
 *
 * Tests exported constants from execution.ts and verifies that webhook
 * configuration is correctly preserved by loadAgentConfig().
 *
 * Covers:
 *   - execution/execution.ts: DEFAULT_MAX_RERUNS, DEFAULT_MAX_TRIGGER_DEPTH constants
 *   - shared/config/load-agent.ts: loadAgentConfig() webhooks field preservation
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import {
  DEFAULT_MAX_RERUNS,
  DEFAULT_MAX_TRIGGER_DEPTH,
} from "@action-llama/action-llama/internals/execution";
import { loadAgentConfig } from "@action-llama/action-llama/internals/config";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-exec-const-test-"));
}

function writeGlobalConfig(dir: string): void {
  writeFileSync(
    join(dir, "config.toml"),
    stringifyTOML({
      models: {
        sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
      },
    }),
  );
}

function writeSkillMd(dir: string, agentName: string): void {
  const agentDir = join(dir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  const yamlStr = stringifyYAML({ name: agentName }).trimEnd();
  writeFileSync(join(agentDir, "SKILL.md"), `---\n${yamlStr}\n---\n\n# ${agentName}\n`);
}

function writeAgentConfig(dir: string, agentName: string, config: Record<string, unknown>): void {
  const agentDir = join(dir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(config));
}

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe("execution-constants: DEFAULT_MAX_RERUNS and DEFAULT_MAX_TRIGGER_DEPTH", { timeout: 5_000 }, () => {
  it("DEFAULT_MAX_RERUNS is 10", () => {
    expect(DEFAULT_MAX_RERUNS).toBe(10);
  });

  it("DEFAULT_MAX_TRIGGER_DEPTH is 3", () => {
    expect(DEFAULT_MAX_TRIGGER_DEPTH).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// loadAgentConfig webhooks preservation
// ---------------------------------------------------------------------------

describe("execution-constants: loadAgentConfig preserves webhooks field", { timeout: 10_000 }, () => {
  it("preserves webhooks array with source and events", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "webhook-agent");
    writeAgentConfig(dir, "webhook-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      webhooks: [
        { source: "github", events: ["issues"], actions: ["opened"] },
      ],
    });

    const config = loadAgentConfig(dir, "webhook-agent");
    expect(config.webhooks).toHaveLength(1);
    expect(config.webhooks![0].source).toBe("github");
    expect(config.webhooks![0].events).toEqual(["issues"]);
    expect(config.webhooks![0].actions).toEqual(["opened"]);
  });

  it("preserves multiple webhook entries", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "multi-webhook-agent");
    writeAgentConfig(dir, "multi-webhook-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      webhooks: [
        { source: "github", events: ["issues"] },
        { source: "sentry", events: ["event_alert", "issue"] },
      ],
    });

    const config = loadAgentConfig(dir, "multi-webhook-agent");
    expect(config.webhooks).toHaveLength(2);
    expect(config.webhooks![0].source).toBe("github");
    expect(config.webhooks![1].source).toBe("sentry");
    expect(config.webhooks![1].events).toEqual(["event_alert", "issue"]);
  });

  it("preserves webhook labels filter field", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "label-filter-agent");
    writeAgentConfig(dir, "label-filter-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      webhooks: [
        { source: "github", events: ["issues"], labels: ["bug", "needs-triage"] },
      ],
    });

    const config = loadAgentConfig(dir, "label-filter-agent");
    expect(config.webhooks![0].labels).toEqual(["bug", "needs-triage"]);
  });

  it("webhooks field is undefined when not configured", () => {
    const dir = makeTempDir();
    writeGlobalConfig(dir);
    writeSkillMd(dir, "no-webhook-agent");
    writeAgentConfig(dir, "no-webhook-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    const config = loadAgentConfig(dir, "no-webhook-agent");
    expect(config.webhooks).toBeUndefined();
  });
});
