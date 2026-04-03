/**
 * Integration tests: cli/commands/mcp.ts init() and cli/commands/claude.ts init()
 * — no Docker required.
 *
 * mcp.ts init() creates/updates a .mcp.json file in the project directory with
 * an action-llama server entry. It handles:
 *   1. No .mcp.json exists → creates new file
 *   2. .mcp.json exists without mcpServers → adds mcpServers key
 *   3. .mcp.json exists with mcpServers but no action-llama → adds entry
 *   4. .mcp.json exists with action-llama entry → overwrites with message
 *
 * claude.ts init() just logs installation instructions.
 *
 * Covers:
 *   - cli/commands/mcp.ts: init() — creates new .mcp.json when none exists
 *   - cli/commands/mcp.ts: init() — adds entry to existing .mcp.json without mcpServers
 *   - cli/commands/mcp.ts: init() — adds entry to .mcp.json that has mcpServers but not action-llama
 *   - cli/commands/mcp.ts: init() — overwrites existing action-llama entry with message
 *   - cli/commands/mcp.ts: init() — output contains .mcp.json path
 *   - cli/commands/mcp.ts: init() — entry has command "al" and args ["mcp", "serve"]
 *   - cli/commands/claude.ts: init() — outputs npx instruction
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { init: mcpInit } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/mcp.js"
);

const { init: claudeInit } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/claude.js"
);

/** Capture console.log output during a callback. */
async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return lines;
}

describe(
  "integration: cli/commands/mcp.ts init() and claude.ts init() (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-mcp-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── mcp.ts init() ────────────────────────────────────────────────────────

    it("creates new .mcp.json when none exists", async () => {
      await mcpInit({ project: projectDir });

      const mcpJsonPath = join(projectDir, ".mcp.json");
      expect(existsSync(mcpJsonPath)).toBe(true);
    });

    it("created .mcp.json has mcpServers.action-llama entry", async () => {
      await mcpInit({ project: projectDir });

      const content = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
      expect(content).toHaveProperty("mcpServers");
      expect(content.mcpServers).toHaveProperty("action-llama");
    });

    it("entry has command 'al'", async () => {
      await mcpInit({ project: projectDir });

      const content = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
      expect(content.mcpServers["action-llama"].command).toBe("al");
    });

    it("entry has args ['mcp', 'serve']", async () => {
      await mcpInit({ project: projectDir });

      const content = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
      expect(content.mcpServers["action-llama"].args).toEqual(["mcp", "serve"]);
    });

    it("logs 'Wrote .mcp.json' message on creation", async () => {
      const lines = await captureLog(() => mcpInit({ project: projectDir }));

      expect(lines.some((l) => l.includes(".mcp.json"))).toBe(true);
    });

    it("adds entry to existing .mcp.json without mcpServers key", async () => {
      writeFileSync(
        join(projectDir, ".mcp.json"),
        JSON.stringify({ otherKey: "value" }, null, 2)
      );

      await mcpInit({ project: projectDir });

      const content = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
      expect(content.mcpServers).toBeDefined();
      expect(content.mcpServers["action-llama"]).toBeDefined();
      // Original key should be preserved
      expect(content.otherKey).toBe("value");
    });

    it("adds entry to existing .mcp.json that has mcpServers but no action-llama", async () => {
      const initial = {
        mcpServers: {
          "other-tool": { command: "other", args: ["serve"] },
        },
      };
      writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify(initial, null, 2));

      await mcpInit({ project: projectDir });

      const content = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
      // Existing entry preserved
      expect(content.mcpServers["other-tool"]).toBeDefined();
      // action-llama entry added
      expect(content.mcpServers["action-llama"]).toBeDefined();
    });

    it("overwrites existing action-llama entry in .mcp.json", async () => {
      const initial = {
        mcpServers: {
          "action-llama": { command: "old-command", args: ["old-arg"] },
        },
      };
      writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify(initial, null, 2));

      const lines = await captureLog(() => mcpInit({ project: projectDir }));

      // Should log that it's overwriting
      expect(lines.some((l) => l.includes("Overwriting") || l.includes("already has") || l.includes("overwriting"))).toBe(true);

      // Entry should now be updated to the correct values
      const content = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
      expect(content.mcpServers["action-llama"].command).toBe("al");
    });

    it("is idempotent — running twice produces valid JSON with al entry", async () => {
      await mcpInit({ project: projectDir });
      await mcpInit({ project: projectDir });

      // Should still be valid JSON
      const content = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf-8"));
      expect(content.mcpServers["action-llama"].command).toBe("al");
    });

    it("logs path of created/updated .mcp.json file", async () => {
      const lines = await captureLog(() => mcpInit({ project: projectDir }));

      // Should log the actual file path
      const allOutput = lines.join("\n");
      expect(allOutput).toContain(projectDir);
    });

    // ── claude.ts init() ─────────────────────────────────────────────────────

    it("logs npx instruction for installing Action Llama skills", async () => {
      const lines = await captureLog(() => claudeInit({ project: projectDir }));
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("npx");
    });

    it("mentions 'skills add' in the instruction", async () => {
      const lines = await captureLog(() => claudeInit({ project: projectDir }));
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("skills add");
    });

    it("mentions 'Action-Llama/skill' in the instruction", async () => {
      const lines = await captureLog(() => claudeInit({ project: projectDir }));
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("Action-Llama/skill");
    });

    it("returns void (no error thrown)", async () => {
      await expect(claudeInit({ project: projectDir })).resolves.toBeUndefined();
    });
  },
);
