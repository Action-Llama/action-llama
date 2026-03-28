import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { resolveTarget } from "../../src/cli/resolve-target.js";

/** Write a minimal agent config so loadAgentConfig succeeds. */
function writeMinimalAgent(projectDir: string, agentName: string) {
  const agentDir = resolve(projectDir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  // Write SKILL.md (required by loadAgentConfig)
  writeFileSync(
    resolve(agentDir, "SKILL.md"),
    `---\nname: ${agentName}\n---\n\n# ${agentName}\n`,
  );

  // Write per-agent config.toml with required models field
  writeFileSync(
    resolve(agentDir, "config.toml"),
    stringifyTOML({
      models: ["sonnet"],
      schedule: "0 * * * *",
    }),
  );

  // Write project config.toml with model definitions
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
    }),
  );
}

describe("resolveTarget", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-resolve-target-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a known agent name from local config", async () => {
    writeMinimalAgent(tmpDir, "my-agent");
    const result = await resolveTarget("my-agent", tmpDir);
    expect(result.agent).toBe("my-agent");
    expect(result.taskId).toBeUndefined();
  });

  it("passes through unknown strings when no local config is found", async () => {
    // No agent directory — falls through to pass-through behavior
    const result = await resolveTarget("scheduler", tmpDir);
    expect(result.agent).toBe("scheduler");
  });

  it("passes through arbitrary strings that are not local agents", async () => {
    const result = await resolveTarget("nonexistent-agent", tmpDir);
    expect(result.agent).toBe("nonexistent-agent");
  });

  it("returns same agent name for known agent (both paths return same value)", async () => {
    writeMinimalAgent(tmpDir, "coder");
    const known = await resolveTarget("coder", tmpDir);
    expect(known.agent).toBe("coder");

    // When not a valid config, still returns the same raw string
    const unknown = await resolveTarget("coder-unknown", tmpDir);
    expect(unknown.agent).toBe("coder-unknown");
  });

  it("returns a ResolvedTarget with agent field for any input", async () => {
    const result = await resolveTarget("any-value", tmpDir);
    expect(result).toHaveProperty("agent");
    expect(result.agent).toBe("any-value");
  });
});
