/**
 * Integration tests: agents/prompt.ts buildLockSkill() and buildSubagentSkill() — no Docker required.
 *
 * These two exported functions build the locking and subagent skill blocks that
 * are injected into agent prompts. They are pure functions (no I/O) and can be
 * tested without Docker or a running scheduler.
 *
 * buildLockSkill() — Returns the <skill-lock> block containing documentation
 * about the rlock/runlock/rlock-heartbeat commands.
 *
 * buildSubagentSkill(availableAgents?) — Returns the <skill-subagent> block.
 * When availableAgents is provided, lists each agent's name and description.
 * When availableAgents is empty or undefined, omits the agent list.
 *
 * Test scenarios (no Docker required):
 *   1. buildLockSkill() returns a string containing <skill-lock> tags
 *   2. buildLockSkill() contains rlock command documentation
 *   3. buildLockSkill() contains runlock command documentation
 *   4. buildLockSkill() contains rlock-heartbeat command documentation
 *   5. buildLockSkill() is always the same string (idempotent)
 *   6. buildSubagentSkill() without agents returns <skill-subagent> block
 *   7. buildSubagentSkill() without agents does NOT include agent list
 *   8. buildSubagentSkill() with agents lists each agent's name
 *   9. buildSubagentSkill() with agents lists each agent's description
 *   10. buildSubagentSkill() with single agent contains agent block
 *   11. buildSubagentSkill() with multiple agents contains all names
 *   12. buildSubagentSkill() with empty array behaves same as undefined
 *   13. buildSubagentSkill() returns al-subagent command documentation
 *   14. buildSubagentSkill() returns al-subagent-check command documentation
 *   15. buildSubagentSkill() includes <skill-subagent> and </skill-subagent> tags
 *
 * Covers:
 *   - agents/prompt.ts: buildLockSkill() — all content branches
 *   - agents/prompt.ts: buildSubagentSkill() — undefined/empty/populated availableAgents
 */

import { describe, it, expect } from "vitest";

const {
  buildLockSkill,
  buildSubagentSkill,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/prompt.js"
);

describe(
  "integration: agents/prompt.ts buildLockSkill() and buildSubagentSkill() (no Docker required)",
  { timeout: 15_000 },
  () => {
    // ── buildLockSkill() ───────────────────────────────────────────────────────

    describe("buildLockSkill()", () => {
      it("returns a string", () => {
        expect(typeof buildLockSkill()).toBe("string");
      });

      it("contains <skill-lock> opening tag", () => {
        expect(buildLockSkill()).toContain("<skill-lock>");
      });

      it("contains </skill-lock> closing tag", () => {
        expect(buildLockSkill()).toContain("</skill-lock>");
      });

      it("contains rlock command", () => {
        expect(buildLockSkill()).toContain("rlock");
      });

      it("contains runlock command", () => {
        expect(buildLockSkill()).toContain("runlock");
      });

      it("contains rlock-heartbeat command", () => {
        expect(buildLockSkill()).toContain("rlock-heartbeat");
      });

      it("contains 'Resource Locking' heading", () => {
        expect(buildLockSkill()).toContain("Resource Locking");
      });

      it("mentions lock TTL (30 minutes)", () => {
        expect(buildLockSkill()).toContain("30 minutes");
      });

      it("is idempotent — same output on every call", () => {
        const first = buildLockSkill();
        const second = buildLockSkill();
        expect(first).toBe(second);
      });

      it("starts with <skill-lock> tag", () => {
        expect(buildLockSkill().startsWith("<skill-lock>")).toBe(true);
      });

      it("ends with </skill-lock> tag", () => {
        const result = buildLockSkill().trim();
        expect(result.endsWith("</skill-lock>")).toBe(true);
      });
    });

    // ── buildSubagentSkill() ─────────────────────────────���─────────────────────

    describe("buildSubagentSkill()", () => {
      // -- no agents --

      it("returns a string when called without arguments", () => {
        expect(typeof buildSubagentSkill()).toBe("string");
      });

      it("contains <skill-subagent> opening tag without agents", () => {
        expect(buildSubagentSkill()).toContain("<skill-subagent>");
      });

      it("contains </skill-subagent> closing tag without agents", () => {
        expect(buildSubagentSkill()).toContain("</skill-subagent>");
      });

      it("contains al-subagent command", () => {
        expect(buildSubagentSkill()).toContain("al-subagent");
      });

      it("contains al-subagent-check command", () => {
        expect(buildSubagentSkill()).toContain("al-subagent-check");
      });

      it("does NOT contain 'Available Agents' heading when no agents", () => {
        expect(buildSubagentSkill()).not.toContain("### Available Agents");
      });

      it("does NOT include agent list when called with undefined", () => {
        expect(buildSubagentSkill(undefined)).not.toContain("Available Agents");
      });

      it("does NOT include agent list when called with empty array", () => {
        expect(buildSubagentSkill([])).not.toContain("Available Agents");
      });

      // -- with agents --

      it("includes 'Available Agents' heading when agents are provided", () => {
        const agents = [{ name: "my-agent", description: "Does stuff" }];
        expect(buildSubagentSkill(agents)).toContain("Available Agents");
      });

      it("includes agent name in the output", () => {
        const agents = [{ name: "researcher", description: "Researches topics" }];
        const result = buildSubagentSkill(agents);
        expect(result).toContain("researcher");
      });

      it("includes agent description in the output", () => {
        const agents = [{ name: "researcher", description: "Researches topics" }];
        const result = buildSubagentSkill(agents);
        expect(result).toContain("Researches topics");
      });

      it("includes all agents when multiple are provided", () => {
        const agents = [
          { name: "agent-alpha", description: "Alpha agent" },
          { name: "agent-beta", description: "Beta agent" },
          { name: "agent-gamma", description: "Gamma agent" },
        ];
        const result = buildSubagentSkill(agents);
        expect(result).toContain("agent-alpha");
        expect(result).toContain("agent-beta");
        expect(result).toContain("agent-gamma");
      });

      it("includes all descriptions when multiple agents are provided", () => {
        const agents = [
          { name: "alpha", description: "First agent does X" },
          { name: "beta", description: "Second agent does Y" },
        ];
        const result = buildSubagentSkill(agents);
        expect(result).toContain("First agent does X");
        expect(result).toContain("Second agent does Y");
      });

      it("starts with <skill-subagent> tag", () => {
        expect(buildSubagentSkill().startsWith("<skill-subagent>")).toBe(true);
      });

      it("ends with </skill-subagent> tag", () => {
        const result = buildSubagentSkill().trim();
        expect(result.endsWith("</skill-subagent>")).toBe(true);
      });

      it("result with agents is longer than result without agents", () => {
        const withoutAgents = buildSubagentSkill();
        const withAgents = buildSubagentSkill([{ name: "my-agent", description: "My desc" }]);
        expect(withAgents.length).toBeGreaterThan(withoutAgents.length);
      });
    });
  },
);
