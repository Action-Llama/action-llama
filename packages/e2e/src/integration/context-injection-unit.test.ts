/**
 * Integration tests: agents/context-injection.ts processContextInjection() — no Docker required.
 *
 * processContextInjection() scans a SKILL.md body for `!`command`` expressions,
 * executes each command via execSync, and replaces the expression with stdout.
 * On failure, it replaces with `[Error: <message>]`.
 *
 * The function is a pure text processor — it only uses execSync with real shell
 * commands. Tests can exercise all code paths without Docker by using simple
 * shell commands that work anywhere (echo, false, etc.).
 *
 * Test scenarios (no Docker required):
 *   1. No injection tokens → body returned unchanged
 *   2. Single successful injection → replaced with command stdout
 *   3. Failed command → replaced with [Error: ...] placeholder
 *   4. Multiple injections in one body → all replaced independently
 *   5. Injection at start of line
 *   6. Injection after whitespace/newline
 *   7. Empty body → returns empty string
 *   8. Injection stdout is trimmed (trimEnd)
 *   9. Long error messages are truncated to 500 chars in placeholder
 *   10. Environment variables passed to the command via env param
 *
 * Covers:
 *   - agents/context-injection.ts: processContextInjection() no-tokens passthrough
 *   - agents/context-injection.ts: processContextInjection() successful command → stdout
 *   - agents/context-injection.ts: processContextInjection() failed command → [Error: ...]
 *   - agents/context-injection.ts: processContextInjection() multiple injections
 *   - agents/context-injection.ts: processContextInjection() trimEnd on stdout
 *   - agents/context-injection.ts: processContextInjection() env forwarding
 */

import { describe, it, expect } from "vitest";

const { processContextInjection } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/context-injection.js"
);

describe(
  "integration: agents/context-injection.ts processContextInjection() (no Docker required)",
  { timeout: 30_000 },
  () => {
    // ── No injection tokens ──────────────────────────────────────────────────

    it("returns body unchanged when no injection tokens are present", () => {
      const body = "# My Agent\n\nThis is the agent description.\n\nNo injection here.";
      const result = processContextInjection(body, {});
      expect(result).toBe(body);
    });

    it("returns empty string unchanged when body is empty", () => {
      const result = processContextInjection("", {});
      expect(result).toBe("");
    });

    it("returns body unchanged when backtick expressions exist without ! prefix", () => {
      const body = "Use `ls -la` to list files.";
      const result = processContextInjection(body, {});
      // Regular backticks without ! should not be replaced
      expect(result).toBe(body);
    });

    // ── Successful command injection ─────────────────────────────────────────

    it("replaces single injection token with command stdout", () => {
      const body = "Current time: !`echo hello-world`";
      const result = processContextInjection(body, {});
      expect(result).toBe("Current time: hello-world");
    });

    it("replaces injection with exact command output (trimmed)", () => {
      const body = "Value: !`echo 42`";
      const result = processContextInjection(body, {});
      expect(result).toBe("Value: 42");
    });

    it("trims trailing whitespace/newlines from command output", () => {
      // echo adds a newline — should be trimmed
      const body = "!`echo test`";
      const result = processContextInjection(body, {});
      // Should not end with a newline
      expect(result).not.toMatch(/\n$/);
      expect(result).toBe("test");
    });

    // ── Failed command injection ─────────────────────────────────────────────

    it("replaces failed command with [Error: ...] placeholder", () => {
      const body = "!`false`";
      const result = processContextInjection(body, {});
      // The 'false' command exits with code 1
      expect(result).toMatch(/^\[Error:.*\]$/);
    });

    it("[Error: ...] placeholder is produced for nonexistent command", () => {
      const body = "!`nonexistent-command-xyz-123`";
      const result = processContextInjection(body, {});
      expect(result).toMatch(/^\[Error:/);
      expect(result).toMatch(/\]$/);
    });

    it("[Error: ...] placeholder is a single replacement (not multiple)", () => {
      const body = "!`false`";
      const result = processContextInjection(body, {});
      // Should be exactly one [Error: ...] replacement for the one failed injection
      expect(result.match(/\[Error:/g)?.length).toBe(1);
    });

    // ── Multiple injections ─────────────────────────────────────────────────

    it("replaces multiple injection tokens independently", () => {
      const body = "A: !`echo alpha` and B: !`echo beta`";
      const result = processContextInjection(body, {});
      expect(result).toBe("A: alpha and B: beta");
    });

    it("replaces mix of successful and failed injections", () => {
      const body = "ok=!`echo done` err=!`false`";
      const result = processContextInjection(body, {});
      expect(result).toMatch(/^ok=done err=\[Error:/);
    });

    // ── Injection position ───────────────────────────────────────────────────

    it("replaces injection at start of body", () => {
      const body = "!`echo first` more text";
      const result = processContextInjection(body, {});
      expect(result).toBe("first more text");
    });

    it("replaces injection at start of a line", () => {
      const body = "First line\n!`echo second-line` rest";
      const result = processContextInjection(body, {});
      expect(result).toBe("First line\nsecond-line rest");
    });

    it("replaces injection after whitespace", () => {
      const body = "Value is !`echo found`";
      const result = processContextInjection(body, {});
      expect(result).toBe("Value is found");
    });

    // ── Environment variables ─────────────────────────────────────────────────

    it("passes environment variables to the command", () => {
      const body = "!`echo $MY_TEST_VAR`";
      const env = { MY_TEST_VAR: "injected-value" };
      const result = processContextInjection(body, env);
      expect(result).toBe("injected-value");
    });

    it("command with no env var access still works with empty env", () => {
      const body = "!`echo constant`";
      const result = processContextInjection(body, {});
      expect(result).toBe("constant");
    });
  },
);
