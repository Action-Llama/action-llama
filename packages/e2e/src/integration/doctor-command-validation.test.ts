/**
 * Integration tests: cli/commands/doctor.ts execute() per-agent validation paths
 * — no Docker required.
 *
 * The doctor command performs multiple validation passes over agents and global
 * config. The existing doctor-command-guards.test.ts only covers the early-exit
 * guards (SKILL.md guard, no agents, unknown global config field). This file
 * covers the deeper validation paths:
 *
 *   1. Agent references a model that is not defined in config.toml
 *      → validationError: 'references model "..." which is not defined'
 *
 *   2. Agent uses pi_auth authType for a model
 *      → validationError: 'uses pi_auth ... not supported in container mode'
 *
 *   3. Webhook source with unknown provider type
 *      → validationError: 'has unknown type "..." Known types: ...'
 *
 *   4. Agent webhook trigger references undefined webhook source
 *      → validationError: 'references webhook source "..." which is not defined'
 *
 *   5. Agent scale exceeds project scale limit
 *      → validationError: 'scale (N) exceeds project scale limit (M)'
 *
 *   6. Unknown field in agent SKILL.md frontmatter
 *      → validationError: 'Unknown fields in agent "..." SKILL.md: ...'
 *
 *   7. Unknown field in agent config.toml
 *      → validationError: 'Unknown fields in agent "..." config.toml: ...'
 *
 *   8. Total requested scale exceeds project scale cap (warning, not error)
 *      → validationWarning BUT does not throw by itself (only throws when errors exist)
 *
 * Each test scenario creates a minimal project in a temp directory, runs
 * doctor with skipCredentials=true and silent=true (to avoid I/O), then
 * asserts the ConfigError message content.
 *
 * Covers:
 *   - cli/commands/doctor.ts: model ref not in globalConfig → validationErrors (lines 143-151)
 *   - cli/commands/doctor.ts: pi_auth model validation → validationErrors (lines 153-160)
 *   - cli/commands/doctor.ts: unknown webhook source type → validationErrors (lines 188-194)
 *   - cli/commands/doctor.ts: agent webhook references missing source → validationErrors (lines 200-212)
 *   - cli/commands/doctor.ts: agent scale > project scale → validationErrors (lines 173-177)
 *   - cli/commands/doctor.ts: unknown SKILL.md frontmatter fields → validationErrors (lines 110-113)
 *   - cli/commands/doctor.ts: unknown config.toml runtime fields → validationErrors (lines 115-120)
 *   - cli/commands/doctor.ts: total scale > project cap → validationWarnings (lines 178-183)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setDefaultBackend, resetDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const { execute: doctorExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/doctor.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-doctor-val-"));
}

/** Write a minimal valid global config with one model. */
function writeGlobalConfig(dir: string, extra = ""): void {
  writeFileSync(
    join(dir, "config.toml"),
    `[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n${extra}`,
  );
}

/** Write a minimal agent SKILL.md. */
function writeSkillMd(dir: string, agentName: string, frontmatterExtra = ""): void {
  const agentDir = join(dir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "SKILL.md"),
    `---\ndescription: "Test agent"\n${frontmatterExtra}---\n\n# ${agentName}\n`,
  );
}

/** Write a minimal agent config.toml. */
function writeAgentConfig(dir: string, agentName: string, content: string): void {
  const agentDir = join(dir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "config.toml"), content);
}

describe(
  "integration: cli/commands/doctor.ts per-agent validation paths (no Docker required)",
  { timeout: 30_000 },
  () => {
    let tmpDir: string;
    let credDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
      credDir = mkdtempSync(join(tmpdir(), "al-doctor-creds-"));
      setDefaultBackend(new FilesystemBackend(credDir));
    });

    afterEach(() => {
      resetDefaultBackend();
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(credDir, { recursive: true, force: true });
    });

    // ── 1. Agent references undefined model ──────────────────────────────────

    it("throws ConfigError when agent references a model not in config.toml", async () => {
      writeGlobalConfig(tmpDir);
      writeSkillMd(tmpDir, "my-agent");
      writeAgentConfig(
        tmpDir,
        "my-agent",
        'models = ["undefined-model"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ConfigError).toBe(true);
      expect(caughtError.message).toMatch(/references model.*undefined-model.*not defined/i);
    });

    it("error message for missing model includes available models list", async () => {
      writeGlobalConfig(tmpDir);
      writeSkillMd(tmpDir, "my-agent");
      writeAgentConfig(
        tmpDir,
        "my-agent",
        'models = ["missing-model"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      // Should mention the available model "sonnet"
      expect(caughtError.message).toContain("sonnet");
    });

    // ── 2. Agent uses pi_auth model ──────────────────────────────────────────

    it("throws ConfigError when agent uses pi_auth model", async () => {
      // Add a pi_auth model to global config
      writeFileSync(
        join(tmpDir, "config.toml"),
        `[models.pi]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "pi_auth"\n`,
      );
      writeSkillMd(tmpDir, "pi-agent");
      writeAgentConfig(
        tmpDir,
        "pi-agent",
        'models = ["pi"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ConfigError).toBe(true);
      expect(caughtError.message).toMatch(/pi_auth.*not supported in container mode/i);
    });

    it("pi_auth error message mentions 'api_key/oauth_token' alternative", async () => {
      writeFileSync(
        join(tmpDir, "config.toml"),
        `[models.mymodel]\nprovider = "openai"\nmodel = "gpt-4o"\nauthType = "pi_auth"\n`,
      );
      writeSkillMd(tmpDir, "pi-agent");
      writeAgentConfig(
        tmpDir,
        "pi-agent",
        'models = ["mymodel"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.message).toContain("api_key");
    });

    // ── 3. Unknown webhook provider type ─────────────────────────────────────

    it("throws ConfigError when global config has webhook source with unknown type", async () => {
      writeFileSync(
        join(tmpDir, "config.toml"),
        `[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n\n[webhooks.my-hook]\ntype = "totally-unknown-provider"\n`,
      );
      writeSkillMd(tmpDir, "my-agent");
      writeAgentConfig(
        tmpDir,
        "my-agent",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ConfigError).toBe(true);
      expect(caughtError.message).toMatch(/unknown type.*totally-unknown-provider/i);
    });

    it("unknown webhook type error lists known provider types", async () => {
      writeFileSync(
        join(tmpDir, "config.toml"),
        `[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n\n[webhooks.my-hook]\ntype = "bogus-type"\n`,
      );
      writeSkillMd(tmpDir, "my-agent");
      writeAgentConfig(
        tmpDir,
        "my-agent",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      // Should mention known types like "github"
      expect(caughtError.message).toContain("github");
    });

    // ── 4. Agent webhook trigger references undefined source ─────────────────

    it("throws ConfigError when agent trigger references undefined webhook source", async () => {
      writeGlobalConfig(tmpDir);
      writeSkillMd(tmpDir, "my-agent");
      writeAgentConfig(
        tmpDir,
        "my-agent",
        `models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\n\n[[webhooks]]\nsource = "nonexistent-source"\nevents = ["issues"]\n`,
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ConfigError).toBe(true);
      expect(caughtError.message).toMatch(/references webhook source.*nonexistent-source.*not defined/i);
    });

    // ── 5. Agent scale exceeds project scale limit ───────────────────────────

    it("throws ConfigError when agent scale exceeds project scale limit", async () => {
      writeFileSync(
        join(tmpDir, "config.toml"),
        `scale = 1\n\n[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n`,
      );
      writeSkillMd(tmpDir, "heavy-agent");
      writeAgentConfig(
        tmpDir,
        "heavy-agent",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\nscale = 5\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ConfigError).toBe(true);
      expect(caughtError.message).toMatch(/scale.*5.*exceeds project scale limit.*1/i);
    });

    // ── 6. Unknown field in agent SKILL.md frontmatter ───────────────────────

    it("throws ConfigError when agent SKILL.md has unknown frontmatter fields", async () => {
      writeGlobalConfig(tmpDir);
      const agentDir = join(tmpDir, "agents", "my-agent");
      mkdirSync(agentDir, { recursive: true });
      // Use an unknown frontmatter key
      writeFileSync(
        join(agentDir, "SKILL.md"),
        `---\ndescription: "Test"\nunknownFrontmatterKey: value\n---\n\n# My Agent\n`,
      );
      writeAgentConfig(
        tmpDir,
        "my-agent",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ConfigError).toBe(true);
      expect(caughtError.message).toMatch(/Unknown fields in agent.*SKILL\.md.*unknownFrontmatterKey/i);
    });

    // ── 7. Unknown field in agent config.toml ────────────────────────────────

    it("throws ConfigError when agent config.toml has unknown fields", async () => {
      writeGlobalConfig(tmpDir);
      writeSkillMd(tmpDir, "my-agent");
      writeAgentConfig(
        tmpDir,
        "my-agent",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\nunknownRuntimeField = "oops"\n',
      );

      let caughtError: any;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ConfigError).toBe(true);
      expect(caughtError.message).toMatch(/Unknown fields in agent.*config\.toml.*unknownRuntimeField/i);
    });

    // ── 8. Total scale exceeds project cap (warning only) ────────────────────

    it("does NOT throw when only total scale exceeds project cap (warning without error)", async () => {
      // Two agents with scale=1 each but project cap is 1 — this only generates a
      // warning, not an error, as long as no agent individually exceeds the cap.
      // NOTE: both agents have scale=1 <= project scale=1, so no individual agent errors.
      // But totalRequested=2 > projectScale=1 → warning only.
      writeFileSync(
        join(tmpDir, "config.toml"),
        `scale = 1\n\n[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n`,
      );
      writeSkillMd(tmpDir, "agent-a");
      writeAgentConfig(
        tmpDir,
        "agent-a",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\nscale = 1\n',
      );
      writeSkillMd(tmpDir, "agent-b");
      writeAgentConfig(
        tmpDir,
        "agent-b",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\nscale = 1\n',
      );

      // Should complete without throwing (warnings don't cause throws by themselves)
      await expect(
        doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true })
      ).resolves.toBeUndefined();
    });

    // ── Bonus: valid project passes doctor cleanly ────────────────────────────

    it("completes without error for a fully valid project", async () => {
      writeGlobalConfig(tmpDir);
      writeSkillMd(tmpDir, "valid-agent");
      writeAgentConfig(
        tmpDir,
        "valid-agent",
        'models = ["sonnet"]\ncredentials = []\nschedule = "*/5 * * * *"\n',
      );

      await expect(
        doctorExecute({ project: tmpDir, silent: true, skipCredentials: true, checkOnly: true })
      ).resolves.toBeUndefined();
    });
  },
);
