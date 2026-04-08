/**
 * Integration tests: cli/commands/webhook.ts execute() error paths and
 * detectSourceFromHeaders() logic — no Docker required.
 *
 * The `al webhook` command (cli/commands/webhook.ts) supports two sub-commands:
 * "replay" and "simulate". It loads a JSON fixture file, detects the webhook
 * source from headers, and performs a dry-run dispatch.
 *
 * Test scenarios (no Docker required):
 *   1. Unknown command → throws Error "Unknown webhook command: ..."
 *   2. Fixture file not found → throws Error "file not found"
 *   3. Invalid JSON in fixture → throws Error "Failed to load fixture"
 *   4. Fixture missing 'body' field → throws Error "Fixture must have 'headers' and 'body'"
 *   5. Fixture missing 'headers' field → throws Error "Fixture must have 'headers' and 'body'"
 *   6. No recognizable source headers → throws "Could not determine webhook source"
 *   7. x-github-event header → detected as "github" source
 *   8. sentry-hook-resource header → detected as "sentry" source
 *   9. x-linear-signature header → detected as "linear" source
 *   10. x-mintlify-signature header → detected as "mintlify" source
 *   11. x-test-event header → detected as "test" source
 *   12. "simulate" is also accepted as valid command (same as "replay")
 *   13. --source option overrides auto-detection
 *
 * Covers:
 *   - cli/commands/webhook.ts: execute() unknown command → throw Error
 *   - cli/commands/webhook.ts: loadFixture() file not found → throw Error
 *   - cli/commands/webhook.ts: loadFixture() invalid JSON → throw Error
 *   - cli/commands/webhook.ts: loadFixture() missing fields → throw Error
 *   - cli/commands/webhook.ts: detectSourceFromHeaders() all 5 providers
 *   - cli/commands/webhook.ts: detectSourceFromHeaders() unknown → null → throw
 *   - cli/commands/webhook.ts: --source option overrides header detection
 *   - cli/commands/webhook.ts: "simulate" accepted as valid command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { execute: webhookExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/webhook.js"
);

// Helper to write a fixture file in the temp dir
function writeFixture(dir: string, filename: string, content: object | string): string {
  const path = join(dir, filename);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

// A minimal valid fixture with no recognizable source headers
function unknownSourceFixture() {
  return {
    headers: { "content-type": "application/json" },
    body: { action: "test" },
  };
}

// A minimal valid fixture for GitHub
function githubFixture() {
  return {
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "abc-123",
      "content-type": "application/json",
    },
    body: {
      action: "opened",
      repository: { full_name: "test-org/test-repo" },
      issue: {
        number: 1,
        title: "Test Issue",
        body: "body",
        html_url: "https://github.com/test-org/test-repo/issues/1",
        user: { login: "user1" },
        labels: [],
      },
      sender: { login: "user1" },
    },
  };
}

describe(
  "integration: cli/commands/webhook.ts execute() error paths and source detection (no Docker required)",
  { timeout: 30_000 },
  () => {
    let tmpDir: string;
    let projectDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "al-webhook-cmd-"));
      projectDir = mkdtempSync(join(tmpdir(), "al-webhook-project-"));
      // Create agents dir to avoid discoverAgents warnings
      mkdirSync(join(projectDir, "agents"), { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── 1. Unknown command ────────────────────────────────────────────────────

    it("throws Error for unknown command name", async () => {
      const fixturePath = writeFixture(tmpDir, "fixture.json", githubFixture());
      await expect(
        webhookExecute("unknown-cmd", fixturePath, { project: projectDir })
      ).rejects.toThrow("Unknown webhook command: unknown-cmd");
    });

    it("throws Error for 'deploy' command (only replay/simulate valid)", async () => {
      const fixturePath = writeFixture(tmpDir, "fixture.json", githubFixture());
      await expect(
        webhookExecute("deploy", fixturePath, { project: projectDir })
      ).rejects.toThrow("Unknown webhook command: deploy");
    });

    // ── 2. Fixture file not found ─────────────────────────────────────────────

    it("throws Error when fixture file does not exist", async () => {
      await expect(
        webhookExecute("replay", "/nonexistent/path/fixture.json", { project: projectDir })
      ).rejects.toThrow("file not found");
    });

    it("error for missing fixture mentions the path", async () => {
      const fakePath = join(tmpDir, "does-not-exist.json");
      let caught: Error | undefined;
      try {
        await webhookExecute("replay", fakePath, { project: projectDir });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("does-not-exist.json");
    });

    // ── 3. Invalid JSON in fixture ────────────────────────────────────────────

    it("throws Error when fixture contains invalid JSON", async () => {
      const fixturePath = writeFixture(tmpDir, "bad.json", "{ not valid json !!!");
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).rejects.toThrow("Failed to load fixture");
    });

    // ── 4. Fixture missing required fields ────────────────────────────────────

    it("throws Error when fixture is missing 'body' field", async () => {
      const fixturePath = writeFixture(tmpDir, "fixture.json", {
        headers: { "x-github-event": "issues" },
        // body intentionally omitted
      });
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).rejects.toThrow("Fixture must have 'headers' and 'body' properties");
    });

    it("throws Error when fixture is missing 'headers' field", async () => {
      const fixturePath = writeFixture(tmpDir, "fixture.json", {
        // headers intentionally omitted
        body: { action: "opened" },
      });
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).rejects.toThrow("Fixture must have 'headers' and 'body' properties");
    });

    // ── 5. No recognizable source headers ────────────────────────────────────

    it("throws Error when no source can be detected from headers", async () => {
      const fixturePath = writeFixture(tmpDir, "fixture.json", unknownSourceFixture());
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).rejects.toThrow("Could not determine webhook source");
    });

    // ── 6. Source detection: x-github-event → github ─────────────────────────

    it("succeeds with github source detected from x-github-event header", async () => {
      const fixturePath = writeFixture(tmpDir, "github.json", githubFixture());
      // Should NOT throw — runs dry dispatch and prints results
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });

    // ── 7. Source detection: sentry headers ──────────────────────────────────

    it("succeeds with sentry source detected from sentry-hook-resource header", async () => {
      const fixturePath = writeFixture(tmpDir, "sentry.json", {
        headers: {
          "sentry-hook-resource": "issue",
          "sentry-hook-signature": "test-sig",
          "content-type": "application/json",
        },
        body: {
          action: "created",
          data: { issue: { id: "123", title: "Test Error" } },
          actor: { name: "sentry" },
        },
      });
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });

    it("succeeds with sentry source detected from x-sentry-auth header", async () => {
      const fixturePath = writeFixture(tmpDir, "sentry2.json", {
        headers: {
          "x-sentry-auth": "Sentry sentry_key=abc123",
          "content-type": "application/json",
        },
        body: {
          action: "created",
          data: { issue: { id: "456", title: "Another Error" } },
          actor: { name: "sentry" },
        },
      });
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });

    // ── 8. Source detection: linear ──────────────────────────────────────────

    it("succeeds with linear source detected from x-linear-signature header", async () => {
      const fixturePath = writeFixture(tmpDir, "linear.json", {
        headers: {
          "x-linear-signature": "sha256=abc123",
          "content-type": "application/json",
        },
        body: {
          action: "create",
          type: "Issue",
          data: { id: "ISSUE-1", title: "Test Linear Issue" },
        },
      });
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });

    // ── 9. Source detection: mintlify ─────────────────────────────────────────

    it("succeeds with mintlify source detected from x-mintlify-signature header", async () => {
      const fixturePath = writeFixture(tmpDir, "mintlify.json", {
        headers: {
          "x-mintlify-signature": "sha256=def456",
          "content-type": "application/json",
        },
        body: {
          event: "page.updated",
          data: { slug: "/docs/guide" },
        },
      });
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });

    // ── 10. Source detection: test ───────────────────────────────────────────

    it("succeeds with test source detected from x-test-event header", async () => {
      const fixturePath = writeFixture(tmpDir, "test-event.json", {
        headers: {
          "x-test-event": "test",
          "content-type": "application/json",
        },
        body: {
          action: "test",
          data: { key: "value" },
        },
      });
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });

    // ── 11. "simulate" command is accepted ───────────────────────────────────

    it("accepts 'simulate' as a valid command (same as 'replay')", async () => {
      const fixturePath = writeFixture(tmpDir, "github.json", githubFixture());
      await expect(
        webhookExecute("simulate", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });

    // ── 12. --source option overrides header detection ────────────────────────

    it("--source option overrides auto-detection from headers", async () => {
      // Fixture has no recognizable source headers, but --source=github is passed
      const fixturePath = writeFixture(tmpDir, "fixture.json", unknownSourceFixture());
      // Providing source manually bypasses header detection
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir, source: "github" })
      ).resolves.toBeUndefined();
    });

    // ── 13. "replay" with real example fixture ───────────────────────────────

    it("processes the example-github-fixture.json from repo root", async () => {
      const fixturePath = "/tmp/repo/example-github-fixture.json";
      await expect(
        webhookExecute("replay", fixturePath, { project: projectDir })
      ).resolves.toBeUndefined();
    });
  },
);
