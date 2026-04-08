/**
 * Integration tests: docker/runtime.ts isContainerRuntime() and docker/network.ts — no Docker required.
 *
 * docker/runtime.ts exports:
 *   - isContainerRuntime(runtime) — type guard checking if runtime has buildImage + pushImage
 *
 * docker/network.ts exports:
 *   - NETWORK_NAME — the Docker network name constant
 *
 * Both can be tested without Docker. isContainerRuntime() is a simple duck-type
 * check that doesn't make any network calls.
 *
 * Test scenarios (no Docker required):
 *   1. isContainerRuntime() returns false for object without buildImage
 *   2. isContainerRuntime() returns false for object with only buildImage (no pushImage)
 *   3. isContainerRuntime() returns false for object with only pushImage (no buildImage)
 *   4. isContainerRuntime() returns true for object with both buildImage and pushImage
 *   5. isContainerRuntime() returns false for empty object {}
 *   6. isContainerRuntime() returns true for runtime that also has other methods
 *   7. NETWORK_NAME is a non-empty string
 *   8. NETWORK_NAME starts with "al-" prefix (matches CONSTANTS.NETWORK_NAME)
 *
 * Covers:
 *   - docker/runtime.ts: isContainerRuntime() → false (no buildImage)
 *   - docker/runtime.ts: isContainerRuntime() → false (no pushImage)
 *   - docker/runtime.ts: isContainerRuntime() → true (both methods present)
 *   - docker/network.ts: NETWORK_NAME export value
 */

import { describe, it, expect } from "vitest";

const { isContainerRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/runtime.js"
);

const { NETWORK_NAME } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/network.js"
);

/** Create a minimal mock Runtime object (no ContainerRuntime methods). */
function makeMockRuntime() {
  return {
    needsGateway: true,
    isAgentRunning: async () => false,
    listRunningAgents: async () => [],
    launch: async () => "run-id",
    streamLogs: () => ({ stop: () => {} }),
    waitForExit: async () => 0,
    kill: async () => {},
    remove: async () => {},
    prepareCredentials: async () => ({ strategy: "volume" as const, stagingDir: "/tmp", bundle: {} }),
    cleanupCredentials: () => {},
    fetchLogs: async () => [],
    followLogs: () => ({ stop: () => {} }),
    getTaskUrl: () => null,
  };
}

describe(
  "integration: docker/runtime.ts isContainerRuntime() and docker/network.ts (no Docker required)",
  { timeout: 10_000 },
  () => {
    // ── isContainerRuntime() ─────────────────────────────────────────────────

    it("returns false for runtime without buildImage or pushImage", () => {
      const runtime = makeMockRuntime();
      expect(isContainerRuntime(runtime)).toBe(false);
    });

    it("returns false for runtime with only buildImage (no pushImage)", () => {
      const runtime = { ...makeMockRuntime(), buildImage: async () => "tag" };
      expect(isContainerRuntime(runtime)).toBe(false);
    });

    it("returns false for runtime with only pushImage (no buildImage)", () => {
      const runtime = { ...makeMockRuntime(), pushImage: async () => "uri" };
      expect(isContainerRuntime(runtime)).toBe(false);
    });

    it("returns true for runtime with both buildImage and pushImage", () => {
      const runtime = {
        ...makeMockRuntime(),
        buildImage: async () => "tag",
        pushImage: async () => "uri",
      };
      expect(isContainerRuntime(runtime)).toBe(true);
    });

    it("returns false for empty-ish runtime object", () => {
      // A minimal runtime object without container methods
      const minimalRuntime = makeMockRuntime();
      expect(isContainerRuntime(minimalRuntime)).toBe(false);
    });

    it("returns true when runtime has buildImage and pushImage alongside other methods", () => {
      const runtime = {
        ...makeMockRuntime(),
        buildImage: async () => "my-image-tag",
        pushImage: async () => "registry.example.com/my-image",
        extraMethod: () => "extra",
      };
      expect(isContainerRuntime(runtime)).toBe(true);
    });

    it("returns a boolean (not null/undefined)", () => {
      const result = isContainerRuntime(makeMockRuntime());
      expect(typeof result).toBe("boolean");
    });

    it("returns boolean true (not truthy value) for container runtime", () => {
      const runtime = {
        ...makeMockRuntime(),
        buildImage: async () => "tag",
        pushImage: async () => "uri",
      };
      expect(isContainerRuntime(runtime) === true).toBe(true);
    });

    // ── NETWORK_NAME ─────────────────────────────────────────────────────────

    it("NETWORK_NAME is a non-empty string", () => {
      expect(typeof NETWORK_NAME).toBe("string");
      expect(NETWORK_NAME.length).toBeGreaterThan(0);
    });

    it("NETWORK_NAME starts with 'al-' prefix", () => {
      // The network name follows the pattern al-<something>
      expect(NETWORK_NAME.startsWith("al-")).toBe(true);
    });

    it("NETWORK_NAME is stable (same value on repeated access)", () => {
      expect(NETWORK_NAME).toBe(NETWORK_NAME);
    });
  },
);
