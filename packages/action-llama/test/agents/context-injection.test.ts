import { describe, it, expect } from "vitest";
import { processContextInjection } from "../../src/agents/context-injection.js";

describe("processContextInjection", () => {
  describe("when body has no injection expressions", () => {
    it("returns the body unchanged", () => {
      const body = "Hello, this is a normal body with no commands.";
      expect(processContextInjection(body, {})).toBe(body);
    });

    it("returns empty string unchanged", () => {
      expect(processContextInjection("", {})).toBe("");
    });

    it("does not process backtick-only expressions (no leading !)", () => {
      const body = "Use `echo hello` for examples.";
      expect(processContextInjection(body, {})).toBe(body);
    });
  });

  describe("when body contains injection expressions", () => {
    it("replaces !`command` with command stdout", () => {
      const body = "Date: !`echo 2026-01-01`";
      const result = processContextInjection(body, {});
      expect(result).toBe("Date: 2026-01-01");
    });

    it("trims trailing newlines from command output", () => {
      const body = "Result: !`printf 'hello\\n'`";
      const result = processContextInjection(body, {});
      expect(result).toBe("Result: hello");
    });

    it("replaces multiple injection expressions in the same body", () => {
      const body = "A: !`echo one` B: !`echo two`";
      const result = processContextInjection(body, {});
      expect(result).toBe("A: one B: two");
    });

    it("passes environment variables to the command", () => {
      const body = "Value: !`echo $MY_VAR`";
      const result = processContextInjection(body, { MY_VAR: "hello-from-env" });
      expect(result).toBe("Value: hello-from-env");
    });

    it("handles multi-word commands", () => {
      const body = "!`printf '%s %s' foo bar`";
      const result = processContextInjection(body, {});
      expect(result).toBe("foo bar");
    });

    it("works with injection at the start of the body", () => {
      const result = processContextInjection("!`echo start`", {});
      expect(result).toBe("start");
    });

    it("works with injection embedded in text", () => {
      const body = "Hello !`echo world` how are you";
      const result = processContextInjection(body, {});
      expect(result).toBe("Hello world how are you");
    });
  });

  describe("when a command fails", () => {
    it("replaces with [Error: ...] on non-zero exit code", () => {
      const body = "Output: !`exit 1`";
      const result = processContextInjection(body, {});
      expect(result).toMatch(/^Output: \[Error: /);
    });

    it("replaces with [Error: ...] for a missing command", () => {
      const body = "!`this-command-does-not-exist-xyz`";
      const result = processContextInjection(body, {});
      expect(result).toMatch(/^\[Error: /);
    });

    it("still processes other expressions after a failed one", () => {
      const body = "!`exit 1` and !`echo ok`";
      const result = processContextInjection(body, {});
      expect(result).toMatch(/^\[Error: .*\] and ok$/);
    });

    it("truncates very long error messages to 500 characters", () => {
      // Generate a long error message via stderr
      const longCmd = "python3 -c \"import sys; sys.stderr.write('x' * 600); sys.exit(1)\" 2>&1 || " +
        "node -e \"process.stderr.write('x'.repeat(600)); process.exit(1)\"";
      const body = "!" + "`" + longCmd + "`";
      const result = processContextInjection(body, {});
      // The error portion should be no longer than [Error: <500 chars>]
      const errorPart = result.replace(/^\[Error: /, "").replace(/\]$/, "");
      expect(errorPart.length).toBeLessThanOrEqual(500);
    });
  });
});
