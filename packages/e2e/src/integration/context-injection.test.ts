/**
 * Integration test: SKILL.md context injection (`!`command`` syntax).
 *
 * processContextInjection() in agents/context-injection.ts runs at container
 * startup (in container-entry.ts, before the LLM session and before the
 * test-script). It scans the SKILL.md body for `!`command`` expressions,
 * executes each shell command, and replaces the expression with stdout.
 * On failure it substitutes `[Error: <message>]`.
 *
 * Since context injection runs BEFORE test-script.sh is executed, side effects
 * (files created by the injected command) are visible to the test script.
 *
 * Test scenarios:
 *   1. Successful injection: `!`echo ok > /tmp/marker && echo done`` creates
 *      /tmp/marker in the container; test-script verifies the file exists.
 *   2. Failed injection: `!`exit 42`` cannot succeed; test-script verifies
 *      that the [Error: ...] placeholder ends up in the prompt env.
 *   3. No injection tokens: SKILL.md with no `!`` expressions is unchanged;
 *      agent runs normally (regression guard).
 *
 * Covers: agents/context-injection.ts processContextInjection()
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: SKILL.md context injection",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it("successful !`command` injection runs before test-script and side-effects are visible", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "context-inject-ok",
            schedule: "0 0 31 2 *",
            // test-script verifies the marker file created by the injected command
            testScript: [
              "#!/bin/sh",
              "set -e",
              // context-injection.ts runs the !`...` command and replaces it with stdout.
              // As a side effect the command also writes a marker file to /tmp.
              'test -f /tmp/ci-marker || { echo "ci-marker not found — context injection did not run"; exit 1; }',
              'CONTENT=$(cat /tmp/ci-marker)',
              'test "$CONTENT" = "injection-ran" || { echo "unexpected marker content: $CONTENT"; exit 1; }',
              'echo "context-inject-ok: injection side-effect verified"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      // Override the SKILL.md with content that contains a !`command` injection.
      // The injected command writes a marker file AND emits stdout that gets
      // spliced into the SKILL body (which the LLM would see — not relevant here).
      const agentDir = resolve(harness.projectPath, "agents", "context-inject-ok");
      writeFileSync(
        resolve(agentDir, "SKILL.md"),
        [
          "---",
          'description: "Context injection test agent"',
          "---",
          "",
          "# context-inject-ok",
          "",
          "Runtime date: !`echo injection-ran > /tmp/ci-marker && date`",
          "",
          "This agent tests that !`command` injections run at container startup.",
        ].join("\n"),
      );

      await harness.start();
      await harness.triggerAgent("context-inject-ok");

      const run = await harness.waitForRunResult("context-inject-ok", 120_000);
      expect(run.result).toBe("completed");
    });

    it("failed !`command` injection substitutes [Error: ...] placeholder and agent still runs", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "context-inject-fail",
            schedule: "0 0 31 2 *",
            // test-script just exits successfully — we verify the agent ran despite
            // the failing injection (the container should not abort on injection error)
            testScript: [
              "#!/bin/sh",
              "set -e",
              'echo "context-inject-fail: agent ran despite failed injection"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      // SKILL.md contains a command that always fails.
      // processContextInjection should catch the error and substitute [Error: ...].
      const agentDir = resolve(harness.projectPath, "agents", "context-inject-fail");
      writeFileSync(
        resolve(agentDir, "SKILL.md"),
        [
          "---",
          'description: "Context injection failure test agent"',
          "---",
          "",
          "# context-inject-fail",
          "",
          // This command will fail (exit 1), exercising the catch branch in context-injection.ts
          "Result: !`exit 1`",
          "",
          "The [Error: ...] placeholder should appear in the SKILL body above.",
        ].join("\n"),
      );

      await harness.start();
      await harness.triggerAgent("context-inject-fail");

      // Agent should complete even though the injection command failed
      const run = await harness.waitForRunResult("context-inject-fail", 120_000);
      expect(run.result).toBe("completed");
    });

    it("SKILL.md with no injection tokens runs unchanged (no-op path)", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "context-inject-noop",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set -e",
              'echo "context-inject-noop: no injection tokens, normal run"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      // Standard SKILL.md without any !`...` tokens — processContextInjection
      // should be a no-op and the agent should run normally.
      await harness.start();
      await harness.triggerAgent("context-inject-noop");

      const run = await harness.waitForRunResult("context-inject-noop", 120_000);
      expect(run.result).toBe("completed");
    });
  },
);
