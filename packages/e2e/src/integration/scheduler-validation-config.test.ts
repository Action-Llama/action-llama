/**
 * Integration tests: scheduler/validation.ts validateAndDiscover() config field
 * resolution — no Docker required.
 *
 * validateAndDiscover() reads several global config fields and returns them in
 * the ValidatedConfig result. The function handles two deprecated config aliases:
 *
 *   - maxTriggerDepth (deprecated) → resolved as maxTriggerDepth in returned config
 *     when maxCallDepth is absent
 *   - maxCallDepth (current key) → takes priority over maxTriggerDepth
 *   - DEFAULT_MAX_TRIGGER_DEPTH fallback when neither is set
 *
 * These tests call validateAndDiscover() directly without the IntegrationHarness,
 * using a minimal project directory with a credential backend pointing to a
 * temp credential store (so requireCredentialRef() succeeds for referenced creds).
 *
 * Test scenarios (no Docker required):
 *   1. maxCallDepth not set, maxTriggerDepth=2 in config → maxTriggerDepth returns 2
 *   2. maxCallDepth=5, maxTriggerDepth=2 → maxCallDepth (5) takes precedence
 *   3. neither set → DEFAULT_MAX_TRIGGER_DEPTH (3) is returned
 *   4. maxReruns=7 in config → maxReruns returns 7
 *   5. maxReruns not set → DEFAULT_MAX_RERUNS (10) is returned
 *
 * Covers:
 *   - scheduler/validation.ts: maxCallDepth ?? maxTriggerDepth ?? DEFAULT fallback chain
 *   - scheduler/validation.ts: maxReruns ?? DEFAULT_MAX_RERUNS fallback
 *   - scheduler/validation.ts: timezone from Intl.DateTimeFormat
 *   - scheduler/validation.ts: anyWebhooks computed from activeAgentConfigs
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import {
  setDefaultBackend,
  resetDefaultBackend,
} from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const { validateAndDiscover } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/validation.js"
);

const { DEFAULT_MAX_TRIGGER_DEPTH, DEFAULT_MAX_RERUNS } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/execution.js"
);

// Minimal pino-style logger for validateAndDiscover
const noop = () => {};
const noopLogger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  child: () => noopLogger,
} as any;

/**
 * Create a minimal project with one scheduled agent (no credentials required).
 */
function createMinimalProject(): { projectPath: string; credentialPath: string } {
  const projectPath = mkdtempSync(join(tmpdir(), "al-val-cfg-test-"));
  const credentialPath = mkdtempSync(join(tmpdir(), "al-val-cred-test-"));

  // Create agents/test-agent/SKILL.md
  const agentDir = join(projectPath, "agents", "test-agent");
  mkdirSync(agentDir, { recursive: true });
  const frontmatter = stringifyYAML({ name: "test-agent" }).trimEnd();
  writeFileSync(join(agentDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Test Agent\n`);

  // Create agents/test-agent/config.toml with schedule (no credentials needed)
  writeFileSync(
    join(agentDir, "config.toml"),
    stringifyTOML({
      models: ["sonnet"],
      credentials: [] as string[],
      schedule: "0 0 31 2 *", // never fires
    }),
  );

  // Create project config.toml (models required for loadAgentConfig resolution)
  writeFileSync(
    join(projectPath, "config.toml"),
    stringifyTOML({
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          authType: "api_key" as const,
        },
      },
    }),
  );

  // Write a fake anthropic_key credential so requireCredentialRef won't fail
  // (agent config has no explicit credentials, but model provider key might be checked)
  // Actually, with scale>0 and no credentials listed, validateAndDiscover won't check anything.
  // But to be safe, use a temp credential backend with no actual creds needed.

  return { projectPath, credentialPath };
}

describe(
  "integration: validateAndDiscover() config field resolution (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectPath: string | undefined;
    let credentialPath: string | undefined;

    afterEach(() => {
      resetDefaultBackend();
      if (projectPath) {
        try { rmSync(projectPath, { recursive: true, force: true }); } catch {}
      }
      if (credentialPath) {
        try { rmSync(credentialPath, { recursive: true, force: true }); } catch {}
      }
      projectPath = undefined;
      credentialPath = undefined;
    });

    // ── maxTriggerDepth (deprecated alias) ────────────────────────────────────

    it("maxTriggerDepth in config is honoured when maxCallDepth is absent", async () => {
      ({ projectPath, credentialPath } = createMinimalProject());
      setDefaultBackend(new FilesystemBackend(credentialPath));

      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        },
        maxTriggerDepth: 2, // deprecated alias — maxCallDepth absent
      } as any;

      const result = await validateAndDiscover(projectPath, globalConfig, noopLogger);

      expect(result.maxTriggerDepth).toBe(2);
    });

    it("maxCallDepth takes precedence over maxTriggerDepth when both are set", async () => {
      ({ projectPath, credentialPath } = createMinimalProject());
      setDefaultBackend(new FilesystemBackend(credentialPath));

      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        },
        maxCallDepth: 5,    // new key
        maxTriggerDepth: 2, // deprecated alias
      } as any;

      const result = await validateAndDiscover(projectPath, globalConfig, noopLogger);

      // maxCallDepth (5) takes precedence over maxTriggerDepth (2)
      expect(result.maxTriggerDepth).toBe(5);
    });

    it("uses DEFAULT_MAX_TRIGGER_DEPTH when neither maxCallDepth nor maxTriggerDepth is set", async () => {
      ({ projectPath, credentialPath } = createMinimalProject());
      setDefaultBackend(new FilesystemBackend(credentialPath));

      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        },
        // neither maxCallDepth nor maxTriggerDepth
      } as any;

      const result = await validateAndDiscover(projectPath, globalConfig, noopLogger);

      expect(result.maxTriggerDepth).toBe(DEFAULT_MAX_TRIGGER_DEPTH);
    });

    // ── maxReruns ─────────────────────────────────────────────────────────────

    it("maxReruns=7 in config is returned correctly", async () => {
      ({ projectPath, credentialPath } = createMinimalProject());
      setDefaultBackend(new FilesystemBackend(credentialPath));

      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        },
        maxReruns: 7,
      } as any;

      const result = await validateAndDiscover(projectPath, globalConfig, noopLogger);

      expect(result.maxReruns).toBe(7);
    });

    it("uses DEFAULT_MAX_RERUNS when maxReruns is not set in config", async () => {
      ({ projectPath, credentialPath } = createMinimalProject());
      setDefaultBackend(new FilesystemBackend(credentialPath));

      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        },
        // no maxReruns
      } as any;

      const result = await validateAndDiscover(projectPath, globalConfig, noopLogger);

      expect(result.maxReruns).toBe(DEFAULT_MAX_RERUNS);
    });

    // ── anyWebhooks and timezone ───────────────────────────────────────────────

    it("anyWebhooks is false when no agents have webhooks", async () => {
      ({ projectPath, credentialPath } = createMinimalProject());
      setDefaultBackend(new FilesystemBackend(credentialPath));

      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        },
      } as any;

      const result = await validateAndDiscover(projectPath, globalConfig, noopLogger);

      expect(result.anyWebhooks).toBe(false);
    });

    it("timezone is a non-empty string from Intl.DateTimeFormat", async () => {
      ({ projectPath, credentialPath } = createMinimalProject());
      setDefaultBackend(new FilesystemBackend(credentialPath));

      const globalConfig = {
        models: {
          sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        },
      } as any;

      const result = await validateAndDiscover(projectPath, globalConfig, noopLogger);

      expect(typeof result.timezone).toBe("string");
      expect(result.timezone.length).toBeGreaterThan(0);
    });
  },
);
