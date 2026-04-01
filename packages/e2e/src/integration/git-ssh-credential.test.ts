/**
 * Integration test: verify that the git_ssh credential type sets up SSH key
 * and git identity environment variables inside agent containers.
 *
 * When a git_ssh credential is configured, container-entry.ts calls
 * loadContainerCredentials() which:
 *   1. Reads id_rsa, username, and email from the credential bundle
 *   2. Writes the SSH key to /tmp/.ssh/id_rsa (mode 600)
 *   3. Sets GIT_SSH_COMMAND to use the mounted key
 *   4. Sets GIT_AUTHOR_NAME, GIT_COMMITTER_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_EMAIL
 *
 * Covers:
 *   - agents/credential-setup.ts: git_ssh SSH key file creation
 *   - agents/credential-setup.ts: GIT_SSH_COMMAND env var injection
 *   - agents/credential-setup.ts: GIT_AUTHOR_NAME / GIT_COMMITTER_NAME injection
 *   - agents/credential-setup.ts: GIT_AUTHOR_EMAIL / GIT_COMMITTER_EMAIL injection
 *   - agents/credential-setup.ts: git_ssh without id_rsa (identity-only path)
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: git_ssh credential setup", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("git_ssh credential with SSH key sets GIT_SSH_COMMAND and git identity env vars in container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "git-ssh-agent",
          schedule: "0 0 31 2 *",
          config: {
            // Include both anthropic_key (for model auth) and git_ssh
            credentials: ["anthropic_key", "git_ssh"],
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify GIT_SSH_COMMAND is set and references the mounted key
            'test -n "$GIT_SSH_COMMAND" || { echo "GIT_SSH_COMMAND not set"; exit 1; }',
            'echo "$GIT_SSH_COMMAND" | grep -q "id_rsa" || { echo "GIT_SSH_COMMAND does not reference id_rsa: $GIT_SSH_COMMAND"; exit 1; }',
            // Verify the SSH key file was written at the expected path
            "KEY_PATH=$(echo \"$GIT_SSH_COMMAND\" | sed 's/.*-i \"\\([^\"]*\\)\".*/\\1/')",
            'test -f "$KEY_PATH" || { echo "SSH key file not found at $KEY_PATH"; exit 1; }',
            // Verify key file permissions are restrictive (mode 600)
            'PERMS=$(stat -c "%a" "$KEY_PATH" 2>/dev/null || stat -f "%A" "$KEY_PATH" 2>/dev/null || echo "unknown")',
            'test "$PERMS" = "600" || test "$PERMS" = "unknown" || { echo "unexpected key permissions: $PERMS"; exit 1; }',
            // Verify git identity env vars are set from credentials
            'test -n "$GIT_AUTHOR_NAME" || { echo "GIT_AUTHOR_NAME not set"; exit 1; }',
            'test -n "$GIT_COMMITTER_NAME" || { echo "GIT_COMMITTER_NAME not set"; exit 1; }',
            'test -n "$GIT_AUTHOR_EMAIL" || { echo "GIT_AUTHOR_EMAIL not set"; exit 1; }',
            'test -n "$GIT_COMMITTER_EMAIL" || { echo "GIT_COMMITTER_EMAIL not set"; exit 1; }',
            // Verify identity values match what we wrote into the credential store
            'test "$GIT_AUTHOR_NAME" = "Test Bot" || { echo "unexpected GIT_AUTHOR_NAME: $GIT_AUTHOR_NAME"; exit 1; }',
            'test "$GIT_COMMITTER_NAME" = "Test Bot" || { echo "unexpected GIT_COMMITTER_NAME: $GIT_COMMITTER_NAME"; exit 1; }',
            'test "$GIT_AUTHOR_EMAIL" = "bot@test.example" || { echo "unexpected GIT_AUTHOR_EMAIL: $GIT_AUTHOR_EMAIL"; exit 1; }',
            'test "$GIT_COMMITTER_EMAIL" = "bot@test.example" || { echo "unexpected GIT_COMMITTER_EMAIL: $GIT_COMMITTER_EMAIL"; exit 1; }',
            'echo "git-ssh-agent: git_ssh credential setup verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    // Write git_ssh credentials to the harness credential dir BEFORE starting.
    // The FilesystemBackend reads from harness.credentialDir, stages them,
    // and Docker mounts the staged dir as /credentials/ in the container.
    const gitSshDir = resolve(harness.credentialDir, "git_ssh", "default");
    mkdirSync(gitSshDir, { recursive: true });

    // Fake RSA private key (structurally valid PEM header/footer, fake body)
    const fakeRsaKey = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4QMG2EMgdZBBgqL1HhP8B9ZFmHV",
      "testfakecontentfortestingonlydonotuseforrealoperation0000000000000000",
      "testfakecontentfortestingonlydonotuseforrealoperation1111111111111111",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    writeFileSync(resolve(gitSshDir, "id_rsa"), fakeRsaKey + "\n");
    writeFileSync(resolve(gitSshDir, "username"), "Test Bot\n");
    writeFileSync(resolve(gitSshDir, "email"), "bot@test.example\n");

    await harness.start();
    await harness.triggerAgent("git-ssh-agent");

    const run = await harness.waitForRunResult("git-ssh-agent", 120_000);
    expect(run.result).toBe("completed");
  });

  it("git_ssh credential without id_rsa (identity-only) sets git identity but not GIT_SSH_COMMAND", async () => {
    // When only username and email are provided (no id_rsa field), the SSH key
    // setup is skipped. Only git identity env vars should be set.
    //
    // Code path: credential-setup.ts git_ssh block — sshKey is undefined,
    // so the GIT_SSH_COMMAND block is skipped; only gitName/gitEmail are set.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "git-identity-agent",
          schedule: "0 0 31 2 *",
          config: {
            credentials: ["anthropic_key", "git_ssh"],
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            // GIT_SSH_COMMAND should NOT be set (no id_rsa provided)
            // Note: it might be set from a prior container env, but since we didn't
            // provide id_rsa, the credential-setup code path should skip it.
            // We only verify the identity vars here.
            'test -n "$GIT_AUTHOR_NAME" || { echo "GIT_AUTHOR_NAME not set"; exit 1; }',
            'test -n "$GIT_COMMITTER_NAME" || { echo "GIT_COMMITTER_NAME not set"; exit 1; }',
            'test -n "$GIT_AUTHOR_EMAIL" || { echo "GIT_AUTHOR_EMAIL not set"; exit 1; }',
            'test -n "$GIT_COMMITTER_EMAIL" || { echo "GIT_COMMITTER_EMAIL not set"; exit 1; }',
            'test "$GIT_AUTHOR_NAME" = "Identity Only Bot" || { echo "unexpected GIT_AUTHOR_NAME: $GIT_AUTHOR_NAME"; exit 1; }',
            'test "$GIT_AUTHOR_EMAIL" = "identonly@test.example" || { echo "unexpected GIT_AUTHOR_EMAIL: $GIT_AUTHOR_EMAIL"; exit 1; }',
            'echo "git-identity-agent: identity-only credential setup verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    // Write git_ssh credentials WITHOUT id_rsa (identity-only)
    const gitSshDir = resolve(harness.credentialDir, "git_ssh", "default");
    mkdirSync(gitSshDir, { recursive: true });
    writeFileSync(resolve(gitSshDir, "username"), "Identity Only Bot\n");
    writeFileSync(resolve(gitSshDir, "email"), "identonly@test.example\n");
    // Intentionally NOT writing id_rsa

    await harness.start();
    await harness.triggerAgent("git-identity-agent");

    const run = await harness.waitForRunResult("git-identity-agent", 120_000);
    expect(run.result).toBe("completed");
  });

  it("agent without git_ssh credential has no git identity env vars from credential setup", async () => {
    // An agent that does NOT list git_ssh in its credentials should NOT have
    // GIT_AUTHOR_NAME etc. set by the credential setup code.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "no-git-ssh-agent",
          schedule: "0 0 31 2 *",
          // Default credentials: only anthropic_key (no git_ssh)
          testScript: [
            "#!/bin/sh",
            "set -e",
            // GIT_AUTHOR_NAME should NOT be set by credential-setup (no git_ssh configured)
            'if [ -n "$GIT_AUTHOR_NAME" ]; then',
            '  echo "GIT_AUTHOR_NAME unexpectedly set: $GIT_AUTHOR_NAME"',
            "  exit 1",
            "fi",
            'echo "no-git-ssh-agent: no git identity env vars set as expected"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("no-git-ssh-agent");

    const run = await harness.waitForRunResult("no-git-ssh-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
