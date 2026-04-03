/**
 * Integration tests: shared/credential-refs.ts collectCredentialRefs() and
 * related constants — no Docker required.
 *
 * collectCredentialRefs(projectPath, globalConfig) scans all agent directories
 * and computes the full set of credential refs needed, including:
 *   - Explicit credentials listed in each agent's config.toml
 *   - Provider API keys derived from each agent's models
 *   - Webhook secret credentials derived from global webhook sources
 *
 * Also tests:
 *   - WEBHOOK_SECRET_TYPES — maps provider name → first credential type
 *   - IMPLICIT_CREDENTIAL_REFS — the set of always-required credential refs
 *
 * Covers:
 *   - credential-refs.ts: collectCredentialRefs() — empty project (no agents)
 *   - credential-refs.ts: collectCredentialRefs() — explicit credentials collected
 *   - credential-refs.ts: collectCredentialRefs() — model provider key added automatically
 *   - credential-refs.ts: collectCredentialRefs() — pi_auth model NOT added as provider key
 *   - credential-refs.ts: collectCredentialRefs() — webhook source adds secret credential
 *   - credential-refs.ts: collectCredentialRefs() — allowUnsigned source skips secret
 *   - credential-refs.ts: collectCredentialRefs() — unknown webhook source (missing in sources) skipped
 *   - credential-refs.ts: WEBHOOK_SECRET_TYPES — contains all known providers
 *   - credential-refs.ts: IMPLICIT_CREDENTIAL_REFS — contains gateway_api_key
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";

const {
  collectCredentialRefs,
  WEBHOOK_SECRET_TYPES,
  IMPLICIT_CREDENTIAL_REFS,
  credentialRefsToRelativePaths,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/credential-refs.js"
);

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-cred-refs-test-"));
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(
    join(dir, "config.toml"),
    stringifyTOML({
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          authType: "api_key",
        },
      },
    })
  );
  return dir;
}

function addAgent(projectPath: string, agentName: string, config: Record<string, unknown>) {
  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  const yaml = stringifyYAML({ name: agentName }).trimEnd();
  writeFileSync(join(agentDir, "SKILL.md"), `---\n${yaml}\n---\n\n# ${agentName}\n`);
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(config));
}

// ── collectCredentialRefs ──────────────────────────────────────────────────

describe("integration: collectCredentialRefs() (no Docker required)", { timeout: 15_000 }, () => {
  it("returns empty set for project with no agent directories", () => {
    const dir = makeTempProject();
    const refs = collectCredentialRefs(dir, {});
    expect(refs.size).toBe(0);
  });

  it("collects explicit credentials from agent config", () => {
    const dir = makeTempProject();
    addAgent(dir, "my-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key", "github_token"],
      schedule: "*/5 * * * *",
    });
    const refs = collectCredentialRefs(dir, {});
    expect(refs.has("anthropic_key")).toBe(true);
    expect(refs.has("github_token")).toBe(true);
  });

  it("adds provider API key credential from model configuration", () => {
    const dir = makeTempProject();
    addAgent(dir, "model-agent", {
      models: ["sonnet"], // sonnet uses anthropic provider
      credentials: [],
      schedule: "*/5 * * * *",
    });
    const refs = collectCredentialRefs(dir, {});
    // anthropic model → should add anthropic_key
    expect(refs.has("anthropic_key")).toBe(true);
  });

  it("does NOT add provider key for pi_auth models", () => {
    const dir = makeTempProject();
    // Add a model with pi_auth
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        models: {
          pimodel: {
            provider: "anthropic",
            model: "claude-sonnet-4-5",
            authType: "pi_auth",
          },
        },
      })
    );
    addAgent(dir, "pi-agent", {
      models: ["pimodel"],
      credentials: [],
      schedule: "*/5 * * * *",
    });
    const refs = collectCredentialRefs(dir, {});
    // pi_auth → NO provider key should be added
    expect(refs.has("anthropic_key")).toBe(false);
  });

  it("adds webhook secret credential when agent has webhook trigger", () => {
    const dir = makeTempProject();
    addAgent(dir, "webhook-agent", {
      models: ["sonnet"],
      credentials: [],
      webhooks: [{ source: "github-main" }],
    });
    const globalConfig = {
      webhooks: {
        "github-main": { type: "github" },
      },
    };
    const refs = collectCredentialRefs(dir, globalConfig as any);
    // github provider needs github_webhook_secret
    expect([...refs].some((r: string) => r.startsWith("github_webhook_secret"))).toBe(true);
  });

  it("skips webhook secret when source has allowUnsigned=true", () => {
    const dir = makeTempProject();
    addAgent(dir, "unsigned-agent", {
      models: ["sonnet"],
      credentials: [],
      webhooks: [{ source: "github-public" }],
    });
    const globalConfig = {
      webhooks: {
        "github-public": { type: "github", allowUnsigned: true },
      },
    };
    const refs = collectCredentialRefs(dir, globalConfig as any);
    // allowUnsigned → no github_webhook_secret needed
    expect([...refs].some((r: string) => r.startsWith("github_webhook_secret"))).toBe(false);
  });

  it("skips webhook trigger with unknown source (source not in globalConfig.webhooks)", () => {
    const dir = makeTempProject();
    addAgent(dir, "unknown-src-agent", {
      models: ["sonnet"],
      credentials: [],
      webhooks: [{ source: "nonexistent-source" }],
    });
    // No matching source in globalConfig — should not throw, should skip
    expect(() => collectCredentialRefs(dir, {})).not.toThrow();
    const refs = collectCredentialRefs(dir, {});
    // Only the model key, no webhook secret
    expect([...refs].every((r: string) => !r.startsWith("github_webhook_secret"))).toBe(true);
  });

  it("collects refs from multiple agents", () => {
    const dir = makeTempProject();
    addAgent(dir, "agent-a", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });
    addAgent(dir, "agent-b", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/10 * * * *",
    });
    const refs = collectCredentialRefs(dir, {});
    expect(refs.has("anthropic_key")).toBe(true);
    expect(refs.has("github_token")).toBe(true);
  });

  it("does not duplicate credential refs", () => {
    const dir = makeTempProject();
    // Both agents have the same anthropic_key credential
    addAgent(dir, "dup-agent-1", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });
    addAgent(dir, "dup-agent-2", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/10 * * * *",
    });
    const refs = collectCredentialRefs(dir, {});
    const refArray = [...refs];
    const anthropicKeyCount = refArray.filter((r: string) => r === "anthropic_key").length;
    expect(anthropicKeyCount).toBe(1); // Set deduplication
  });
});

// ── WEBHOOK_SECRET_TYPES ───────────────────────────────────────────────────

describe("integration: WEBHOOK_SECRET_TYPES and IMPLICIT_CREDENTIAL_REFS (no Docker required)", { timeout: 5_000 }, () => {
  it("WEBHOOK_SECRET_TYPES contains all known provider types", () => {
    const providers = Object.keys(WEBHOOK_SECRET_TYPES);
    expect(providers).toContain("github");
    expect(providers).toContain("sentry");
    expect(providers).toContain("linear");
    expect(providers).toContain("mintlify");
    expect(providers).toContain("discord");
    expect(providers).toContain("twitter");
  });

  it("WEBHOOK_SECRET_TYPES maps github to github_webhook_secret", () => {
    expect(WEBHOOK_SECRET_TYPES["github"]).toBe("github_webhook_secret");
  });

  it("WEBHOOK_SECRET_TYPES values are all strings", () => {
    for (const [, value] of Object.entries(WEBHOOK_SECRET_TYPES)) {
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it("IMPLICIT_CREDENTIAL_REFS contains gateway_api_key", () => {
    expect(IMPLICIT_CREDENTIAL_REFS.has("gateway_api_key")).toBe(true);
  });

  it("IMPLICIT_CREDENTIAL_REFS is a Set with at least one entry", () => {
    expect(IMPLICIT_CREDENTIAL_REFS instanceof Set).toBe(true);
    expect(IMPLICIT_CREDENTIAL_REFS.size).toBeGreaterThan(0);
  });
});
