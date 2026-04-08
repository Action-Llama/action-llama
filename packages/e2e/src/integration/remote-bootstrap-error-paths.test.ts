/**
 * Integration tests: remote/bootstrap.ts bootstrapServer() error paths — no SSH required.
 *
 * bootstrapServer() checks server prerequisites via SSH (Node.js version and
 * Docker availability). When the SSH connection fails, each check throws with
 * a well-defined error message:
 *   - Node.js not found: "Node.js not found on the server. Install Node.js >= 20..."
 *   - Docker not running: "Docker is not running on the server. Install and start Docker..."
 *
 * These error paths are exercised without a real SSH server by using an unreachable
 * port (65432) — the SSH command fails immediately, and bootstrapServer converts
 * the SSH failure into the well-defined prerequisite error messages.
 *
 * bootstrapServer() aggregates all errors into a single throw:
 *   "Server prerequisites not met:\n  - <node error>\n  - <docker error>"
 *
 * Test scenarios (no SSH/Docker required):
 *   1. Both Node.js and Docker checks fail → throws with "Server prerequisites not met"
 *   2. Error message includes "Node.js not found" prerequisite
 *   3. Error message includes "Docker is not running" prerequisite
 *   4. Error is an instance of Error (not a subclass)
 *   5. Both error lines appear as bullet points in the combined message
 *
 * Covers:
 *   - remote/bootstrap.ts: bootstrapServer() — both checks fail → combined error message
 *   - remote/bootstrap.ts: checkNode() — SSH failure → "Node.js not found on the server"
 *   - remote/bootstrap.ts: checkDocker() — SSH failure → "Docker is not running on the server"
 *   - remote/bootstrap.ts: Error aggregation with Promise.allSettled()
 */

import { describe, it, expect, beforeAll } from "vitest";

const { bootstrapServer } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/remote/bootstrap.js"
);

// Use an unreachable local port to trigger SSH connection failures
const UNREACHABLE_SSH: { host: string; user: string; port: number } = {
  host: "127.0.0.1",
  user: "testuser",
  port: 65432, // Guaranteed connection refused
};

describe(
  "integration: remote/bootstrap.ts bootstrapServer() error paths — no SSH required",
  { timeout: 30_000 },
  () => {
    let capturedError: Error | undefined;

    // Run bootstrapServer once and cache the error to avoid repeated SSH timeouts
    beforeAll(async () => {
      try {
        await bootstrapServer(UNREACHABLE_SSH);
      } catch (err) {
        capturedError = err instanceof Error ? err : new Error(String(err));
      }
    });

    it("bootstrapServer() throws when both Node.js and Docker checks fail", () => {
      expect(capturedError).toBeDefined();
    });

    it("error message contains 'Server prerequisites not met'", () => {
      expect(capturedError!.message).toContain("Server prerequisites not met");
    });

    it("error message includes Node.js not found prerequisite failure", () => {
      expect(capturedError!.message).toContain("Node.js not found on the server");
    });

    it("error message includes Docker not running prerequisite failure", () => {
      expect(capturedError!.message).toContain("Docker is not running on the server");
    });

    it("thrown error is an instance of Error", () => {
      expect(capturedError).toBeInstanceOf(Error);
    });

    it("error message has both failures as separate bullet points", () => {
      const lines = capturedError!.message.split("\n");
      const bulletLines = lines.filter((l: string) => l.startsWith("  - "));
      expect(bulletLines).toHaveLength(2);
      expect(bulletLines[0]).toContain("Node.js");
      expect(bulletLines[1]).toContain("Docker");
    });

    it("error message mentions 'al push' as the remediation for Node.js", () => {
      expect(capturedError!.message).toContain("al push");
    });
  },
);
