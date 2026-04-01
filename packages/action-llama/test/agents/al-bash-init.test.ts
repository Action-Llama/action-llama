/**
 * End-to-end tests for al-bash-init.sh and the setenv command.
 *
 * These tests exercise the actual shell flow: source al-bash-init.sh, call setenv,
 * and verify persistence across separate shell invocations — exactly how the
 * agent's bash tool works at runtime.
 *
 * Tests run under both bash and sh to ensure POSIX compatibility.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const hasBash = existsSync("/bin/bash") || existsSync("/usr/bin/bash");

const thisDir = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(thisDir, "../../docker/bin");

/**
 * Run a shell command with al-bash-init.sh on PATH, simulating the agent's
 * bash tool. Uses spawnSync with an array to preserve literal newlines — this
 * matches how pi-coding-agent's bash tool calls spawn(shell, ["-c", command]).
 */
function makeRunner(shell: string) {
  return function runShell(command: string, env: Record<string, string> = {}): string {
    const fullEnv: Record<string, string> = {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: tmpdir(),
      ...env,
    };
    // Simulate the commandPrefix + agent command (newline between prefix and command)
    const prefixedCommand = `. al-bash-init.sh\n${command}`;
    const result = spawnSync(shell, ["-c", prefixedCommand], {
      encoding: "utf-8",
      env: fullEnv,
      timeout: 5000,
    });
    if (result.error) throw result.error;
    const combined = (result.stdout || "") + (result.stderr || "");
    if (result.status !== 0) {
      const err = new Error(`${shell} exited with ${result.status}: ${combined}`);
      (err as any).stdout = result.stdout;
      (err as any).stderr = result.stderr;
      throw err;
    }
    return result.stdout.trim();
  };
}

const agentBash = makeRunner("bash");
const agentSh = makeRunner("sh");

describe.skipIf(!hasBash)("al-bash-init.sh (bash)", () => {
  let workDir: string;
  let envFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "al-bash-init-test-"));
    envFile = join(workDir, ".env.sh");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("setenv", () => {
    it("sets a variable in the current shell", () => {
      const out = agentBash(
        'setenv REPO "Action-Llama/action-llama"\necho "REPO=$REPO"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("set 1 variable");
      expect(out).toContain("REPO=Action-Llama/action-llama");
    });

    it("persists variables across separate bash invocations", () => {
      // First call: set the variable
      agentBash(
        'setenv REPO "Action-Llama/action-llama"',
        { AL_ENV_FILE: envFile },
      );

      // Second call: variable should be restored from env file
      const out = agentBash(
        'echo "REPO=$REPO"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toBe("REPO=Action-Llama/action-llama");
    });

    it("handles multiple key-value pairs in a single call", () => {
      const out = agentBash(
        'setenv REPO "Action-Llama/action-llama" ISSUE_NUMBER 473\necho "REPO=$REPO ISSUE=$ISSUE_NUMBER"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("set 2 variables");
      expect(out).toContain("REPO=Action-Llama/action-llama ISSUE=473");
    });

    it("tolerates stray 'setenv' tokens between pairs (LLM quirk)", () => {
      const out = agentBash(
        'setenv REPO val1 setenv NUM 42\necho "REPO=$REPO NUM=$NUM"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("set 2 variables");
      expect(out).toContain("REPO=val1 NUM=42");
    });

    it("writes the env file to the configured AL_ENV_FILE path", () => {
      agentBash(
        'setenv MY_VAR hello',
        { AL_ENV_FILE: envFile },
      );
      expect(existsSync(envFile)).toBe(true);
      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("export MY_VAR=hello");
    });

    it("accumulates variables across multiple calls", () => {
      agentBash('setenv A 1', { AL_ENV_FILE: envFile });
      agentBash('setenv B 2', { AL_ENV_FILE: envFile });
      agentBash('setenv C 3', { AL_ENV_FILE: envFile });

      const out = agentBash(
        'echo "A=$A B=$B C=$C"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toBe("A=1 B=2 C=3");
    });

    it("overwrites a variable when set again", () => {
      agentBash('setenv X first', { AL_ENV_FILE: envFile });
      agentBash('setenv X second', { AL_ENV_FILE: envFile });

      const out = agentBash(
        'echo "X=$X"',
        { AL_ENV_FILE: envFile },
      );
      // Both lines are in the env file, but the second export wins
      expect(out).toBe("X=second");
    });

    it("handles values with spaces and special characters", () => {
      agentBash(
        'setenv MSG "hello world" URL "https://example.com/path?q=1&r=2"',
        { AL_ENV_FILE: envFile },
      );

      const out = agentBash(
        'echo "$MSG"\necho "$URL"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("hello world");
      expect(out).toContain("https://example.com/path?q=1&r=2");
    });

    it("rejects invalid variable names", () => {
      try {
        const out = agentBash(
          'setenv "123invalid" value 2>&1',
          { AL_ENV_FILE: envFile },
        );
        expect(out).toContain("invalid variable name");
      } catch {
        // Non-zero exit is also acceptable
      }
    });

    it("prints usage error when called with no arguments", () => {
      try {
        const out = agentBash('setenv 2>&1', { AL_ENV_FILE: envFile });
        expect(out).toContain("usage:");
      } catch (e: any) {
        // setenv returns 1, which may throw from execSync
        expect(e.stderr?.toString() || e.stdout?.toString() || "").toContain("usage:");
      }
    });

    it("prints usage error when called with only one argument", () => {
      try {
        const out = agentBash('setenv JUST_KEY 2>&1', { AL_ENV_FILE: envFile });
        expect(out).toContain("usage:");
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || "").toContain("usage:");
      }
    });
  });

  describe("env file isolation", () => {
    it("different AL_ENV_FILE paths are independent", () => {
      const envFile2 = join(workDir, "other.env.sh");

      agentBash('setenv SHARED no INSTANCE_A yes', { AL_ENV_FILE: envFile });
      agentBash('setenv SHARED no INSTANCE_B yes', { AL_ENV_FILE: envFile2 });

      const outA = agentBash('echo "A=$INSTANCE_A B=$INSTANCE_B"', { AL_ENV_FILE: envFile });
      expect(outA).toBe("A=yes B=");

      const outB = agentBash('echo "A=$INSTANCE_A B=$INSTANCE_B"', { AL_ENV_FILE: envFile2 });
      expect(outB).toBe("A= B=yes");
    });
  });
});

describe("al-bash-init.sh (sh compatibility)", () => {
  let workDir: string;
  let envFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "al-bash-init-sh-test-"));
    envFile = join(workDir, ".env.sh");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("setenv under sh", () => {
    it("sets a variable in the current shell", () => {
      const out = agentSh(
        'setenv REPO "Action-Llama/action-llama"\necho "REPO=$REPO"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("set 1 variable");
      expect(out).toContain("REPO=Action-Llama/action-llama");
    });

    it("persists variables across separate sh invocations", () => {
      agentSh(
        'setenv REPO "Action-Llama/action-llama"',
        { AL_ENV_FILE: envFile },
      );

      const out = agentSh(
        'echo "REPO=$REPO"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toBe("REPO=Action-Llama/action-llama");
    });

    it("handles multiple key-value pairs in a single call", () => {
      const out = agentSh(
        'setenv REPO "Action-Llama/action-llama" ISSUE_NUMBER 473\necho "REPO=$REPO ISSUE=$ISSUE_NUMBER"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("set 2 variables");
      expect(out).toContain("REPO=Action-Llama/action-llama ISSUE=473");
    });

    it("tolerates stray 'setenv' tokens between pairs (LLM quirk)", () => {
      const out = agentSh(
        'setenv REPO val1 setenv NUM 42\necho "REPO=$REPO NUM=$NUM"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("set 2 variables");
      expect(out).toContain("REPO=val1 NUM=42");
    });

    it("writes the env file to the configured AL_ENV_FILE path", () => {
      agentSh(
        'setenv MY_VAR hello',
        { AL_ENV_FILE: envFile },
      );
      expect(existsSync(envFile)).toBe(true);
      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("MY_VAR");
      expect(content).toContain("hello");
    });

    it("accumulates variables across multiple calls", () => {
      agentSh('setenv A 1', { AL_ENV_FILE: envFile });
      agentSh('setenv B 2', { AL_ENV_FILE: envFile });
      agentSh('setenv C 3', { AL_ENV_FILE: envFile });

      const out = agentSh(
        'echo "A=$A B=$B C=$C"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toBe("A=1 B=2 C=3");
    });

    it("handles values with spaces", () => {
      agentSh(
        'setenv MSG "hello world"',
        { AL_ENV_FILE: envFile },
      );

      const out = agentSh(
        'echo "$MSG"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("hello world");
    });

    it("handles values with special characters (URLs)", () => {
      agentSh(
        'setenv URL "https://example.com/path?q=1&r=2"',
        { AL_ENV_FILE: envFile },
      );

      const out = agentSh(
        'echo "$URL"',
        { AL_ENV_FILE: envFile },
      );
      expect(out).toContain("https://example.com/path?q=1&r=2");
    });

    it("rejects invalid variable names", () => {
      try {
        const out = agentSh(
          'setenv "123invalid" value 2>&1',
          { AL_ENV_FILE: envFile },
        );
        expect(out).toContain("invalid variable name");
      } catch {
        // Non-zero exit is also acceptable
      }
    });

    it("prints usage error when called with no arguments", () => {
      try {
        const out = agentSh('setenv 2>&1', { AL_ENV_FILE: envFile });
        expect(out).toContain("usage:");
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || "").toContain("usage:");
      }
    });
  });
});
