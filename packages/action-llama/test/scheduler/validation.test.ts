import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { validateAndDiscover } from "../../src/scheduler/validation.js";

vi.mock("../../src/shared/credentials.js", () => ({
  requireCredentialRef: vi.fn().mockResolvedValue(undefined),
  parseCredentialRef: vi.fn((ref: string) => {
    const idx = ref.indexOf(":");
    if (idx !== -1) return { type: ref.slice(0, idx), instance: ref.slice(idx + 1) };
    return { type: ref, instance: "default" };
  }),
  resolveAgentCredentials: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/events/webhook-setup.js", () => ({
  resolveWebhookSource: vi.fn().mockReturnValue({}),
}));

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

/** Write a minimal agent directory so discoverAgents finds it. */
function writeAgent(
  projectDir: string,
  agentName: string,
  overrides: {
    models?: any[];
    schedule?: string;
    credentials?: string[];
    scale?: number;
  } = {},
) {
  const agentDir = resolve(projectDir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    resolve(agentDir, "SKILL.md"),
    `---\nname: ${agentName}\n---\n# ${agentName}\n`,
  );
  writeFileSync(
    resolve(agentDir, "config.toml"),
    stringifyTOML({
      models: overrides.models ?? ["sonnet"],
      schedule: overrides.schedule ?? "0 * * * *",
      credentials: overrides.credentials ?? [],
      ...(overrides.scale !== undefined ? { scale: overrides.scale } : {}),
    }),
  );
}

function writeGlobalConfig(
  projectDir: string,
  extra: Record<string, any> = {},
) {
  writeFileSync(
    resolve(projectDir, "config.toml"),
    stringifyTOML({
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          authType: "api_key",
        },
      },
      ...extra,
    }),
  );
}

describe("validateAndDiscover", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-validation-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws ConfigError when no agents are found", async () => {
    writeGlobalConfig(tmpDir);
    // No agents directory / no agents written

    const { loadGlobalConfig } = await import("../../src/shared/config.js");
    const globalConfig = loadGlobalConfig(tmpDir);

    await expect(validateAndDiscover(tmpDir, globalConfig, makeLogger())).rejects.toThrow(
      "No agents found"
    );
  });

  it("returns validated config when agents exist", async () => {
    writeGlobalConfig(tmpDir);
    writeAgent(tmpDir, "my-agent");

    const { loadGlobalConfig } = await import("../../src/shared/config.js");
    const globalConfig = loadGlobalConfig(tmpDir);

    const result = await validateAndDiscover(tmpDir, globalConfig, makeLogger());

    expect(result.agentConfigs).toHaveLength(1);
    expect(result.agentConfigs[0].name).toBe("my-agent");
    expect(result.activeAgentConfigs).toHaveLength(1);
  });

  it("excludes agents with scale=0 from activeAgentConfigs", async () => {
    writeGlobalConfig(tmpDir);
    writeAgent(tmpDir, "active-agent");
    writeAgent(tmpDir, "disabled-agent", { scale: 0 });

    const { loadGlobalConfig } = await import("../../src/shared/config.js");
    const globalConfig = loadGlobalConfig(tmpDir);

    const result = await validateAndDiscover(tmpDir, globalConfig, makeLogger());

    expect(result.agentConfigs).toHaveLength(2);
    expect(result.activeAgentConfigs).toHaveLength(1);
    expect(result.activeAgentConfigs[0].name).toBe("active-agent");
  });

  it("throws ConfigError when an active agent uses pi_auth", async () => {
    writeGlobalConfig(tmpDir, {
      models: {
        pimodel: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          authType: "pi_auth",
        },
      },
    });
    writeAgent(tmpDir, "pi-agent", { models: ["pimodel"] });

    const { loadGlobalConfig } = await import("../../src/shared/config.js");
    const globalConfig = loadGlobalConfig(tmpDir);

    await expect(validateAndDiscover(tmpDir, globalConfig, makeLogger())).rejects.toThrow(
      "pi_auth"
    );
  });

  it("uses defaults for maxReruns and maxTriggerDepth when not in globalConfig", async () => {
    writeGlobalConfig(tmpDir);
    writeAgent(tmpDir, "my-agent");

    const { loadGlobalConfig } = await import("../../src/shared/config.js");
    const globalConfig = loadGlobalConfig(tmpDir);

    const result = await validateAndDiscover(tmpDir, globalConfig, makeLogger());

    expect(result.maxReruns).toBe(10);
    expect(result.maxTriggerDepth).toBe(3);
  });

  it("uses globalConfig maxReruns and maxCallDepth when provided", async () => {
    writeGlobalConfig(tmpDir, { maxReruns: 5, maxCallDepth: 2 });
    writeAgent(tmpDir, "my-agent");

    const { loadGlobalConfig } = await import("../../src/shared/config.js");
    const globalConfig = loadGlobalConfig(tmpDir);

    const result = await validateAndDiscover(tmpDir, globalConfig, makeLogger());

    expect(result.maxReruns).toBe(5);
    expect(result.maxTriggerDepth).toBe(2);
  });
});
