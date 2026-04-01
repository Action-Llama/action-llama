/**
 * Integration test: verify that the github_token credential type correctly
 * injects GITHUB_TOKEN, GH_TOKEN, and the git HTTPS credential helper env
 * vars inside agent containers.
 *
 * When a github_token credential is configured, container-entry.ts calls
 * loadContainerCredentials() which exercises these code paths:
 *   1. envVars injection: token → GITHUB_TOKEN
 *   2. Special case: GH_TOKEN alias set alongside GITHUB_TOKEN
 *   3. Git HTTPS credential helper: GIT_TERMINAL_PROMPT, GIT_CONFIG_COUNT,
 *      GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0
 *
 * Covers:
 *   - agents/credential-setup.ts: envVars injection loop (github_token)
 *   - agents/credential-setup.ts: GH_TOKEN alias injection
 *   - agents/credential-setup.ts: git HTTPS credential helper setup
 *   - agents/credential-setup.ts: GIT_TERMINAL_PROMPT=0 injection
 *   - agents/credential-setup.ts: GIT_CONFIG_COUNT / GIT_CONFIG_KEY / GIT_CONFIG_VALUE
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: github_token credential env setup", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("github_token credential injects GITHUB_TOKEN, GH_TOKEN, and git HTTPS credential helper", async () => {
    // The harness sets up github_token/default/token automatically (value: "ghp-test-fake-token").
    // This test verifies all the derived env vars that credential-setup.ts injects.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "github-token-env-agent",
          schedule: "0 0 31 2 *",
          config: {
            // Use both anthropic_key (for model auth) and github_token (for git)
            credentials: ["anthropic_key", "github_token"],
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify GITHUB_TOKEN is set from the credential
            'test -n "$GITHUB_TOKEN" || { echo "GITHUB_TOKEN not set"; exit 1; }',
            // Verify GH_TOKEN alias is set to the same value
            'test -n "$GH_TOKEN" || { echo "GH_TOKEN not set"; exit 1; }',
            'test "$GITHUB_TOKEN" = "$GH_TOKEN" || { echo "GH_TOKEN ($GH_TOKEN) != GITHUB_TOKEN ($GITHUB_TOKEN)"; exit 1; }',
            // Verify GIT_TERMINAL_PROMPT=0 is set (prevents interactive git prompts)
            'test "$GIT_TERMINAL_PROMPT" = "0" || { echo "GIT_TERMINAL_PROMPT not set to 0: $GIT_TERMINAL_PROMPT"; exit 1; }',
            // Verify the git credential helper is configured via GIT_CONFIG_COUNT mechanism
            'test -n "$GIT_CONFIG_COUNT" || { echo "GIT_CONFIG_COUNT not set"; exit 1; }',
            'test "$GIT_CONFIG_COUNT" -ge 1 || { echo "GIT_CONFIG_COUNT should be >= 1: $GIT_CONFIG_COUNT"; exit 1; }',
            // Verify the credential helper key is set correctly
            'test "$GIT_CONFIG_KEY_0" = "credential.helper" || { echo "GIT_CONFIG_KEY_0 unexpected: $GIT_CONFIG_KEY_0"; exit 1; }',
            // Verify the credential helper value contains the token script
            'test -n "$GIT_CONFIG_VALUE_0" || { echo "GIT_CONFIG_VALUE_0 not set"; exit 1; }',
            'echo "$GIT_CONFIG_VALUE_0" | grep -q "GITHUB_TOKEN" || { echo "GIT_CONFIG_VALUE_0 does not reference GITHUB_TOKEN: $GIT_CONFIG_VALUE_0"; exit 1; }',
            'echo "github-token-env-agent: all GITHUB_TOKEN env vars verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("github-token-env-agent");

    const run = await harness.waitForRunResult("github-token-env-agent", 120_000);
    expect(run.result).toBe("completed");
  });

  it("agent without github_token credential has no GITHUB_TOKEN set", async () => {
    // An agent that does NOT list github_token in its credentials should NOT have
    // GITHUB_TOKEN injected by credential-setup.ts.
    //
    // Code path: credential-setup.ts envVars loop iterates credentials; when
    // github_token is absent from the list, no GITHUB_TOKEN injection occurs.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "no-github-token-agent",
          schedule: "0 0 31 2 *",
          config: {
            // Only anthropic_key — no github_token
            credentials: ["anthropic_key"],
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            // GITHUB_TOKEN should NOT be set (no github_token credential configured)
            'if [ -n "$GITHUB_TOKEN" ]; then',
            '  echo "GITHUB_TOKEN unexpectedly set: $GITHUB_TOKEN"',
            "  exit 1",
            "fi",
            // GIT_CONFIG_COUNT should either not be set or be 0
            'if [ -n "$GIT_CONFIG_COUNT" ] && [ "$GIT_CONFIG_COUNT" -gt 0 ]; then',
            '  echo "GIT_CONFIG_COUNT unexpectedly set to $GIT_CONFIG_COUNT without GITHUB_TOKEN"',
            "  exit 1",
            "fi",
            'echo "no-github-token-agent: no GITHUB_TOKEN env vars set as expected"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("no-github-token-agent");

    const run = await harness.waitForRunResult("no-github-token-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
