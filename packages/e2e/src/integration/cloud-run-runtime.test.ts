/**
 * Integration tests: docker/cloud-run-runtime.ts CloudRunRuntime — no Docker/GCP required.
 *
 * CloudRunRuntime implements the Runtime + ContainerRuntime interfaces for
 * Google Cloud Run Jobs. Most methods require real GCP credentials and network
 * access, but the constructor, property accessors, and pure helper functions
 * can be tested in isolation.
 *
 * The private `parseMemoryForCloudRun` function is exercised indirectly through
 * the launch() call (which requires GCP), but the function's logic is clearly
 * self-contained. We can verify the runtime's pure properties directly.
 *
 * Test scenarios (no Docker, no GCP network required):
 *   1.  constructor: accepts a CloudRunRuntimeConfig with a GcpAuth mock
 *   2.  needsGateway: is true (Cloud Run needs gateway for remote agent communication)
 *   3.  getTaskUrl(): returns a correct GCP Console URL string for a given runId
 *   4.  getTaskUrl(): includes the project and region in the URL
 *   5.  getTaskUrl(): includes the runId in the URL
 *   6.  cleanupCredentials(): is a no-op for non-secret-manager strategy
 *   7.  cleanupCredentials(): does not throw for empty secretRefs
 *   8.  inspectContainer(): returns null (Cloud Run does not support inspect)
 *   9.  Two instances with different configs have independent getTaskUrl results
 *  10.  needsGateway is true regardless of config values
 *
 * Covers:
 *   - docker/cloud-run-runtime.ts: CloudRunRuntime constructor
 *   - docker/cloud-run-runtime.ts: needsGateway property (true)
 *   - docker/cloud-run-runtime.ts: getTaskUrl() URL construction
 *   - docker/cloud-run-runtime.ts: cleanupCredentials() no-op for non-secret-manager
 *   - docker/cloud-run-runtime.ts: inspectContainer() null return
 */

import { describe, it, expect } from "vitest";

const { CloudRunRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/cloud-run-runtime.js"
);

const { GcpAuth } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/auth.js"
);

// ── Helper to build a minimal CloudRunRuntimeConfig ───────────────────────────

/**
 * Build a minimal ServiceAccountKey structure for testing.
 * We never actually call getAccessToken() in these tests, so the key
 * values do not need to be valid PEM/RSA.
 */
function makeServiceAccountKey(project = "test-project") {
  return {
    type: "service_account",
    project_id: project,
    private_key_id: "key-id-123",
    private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
    client_email: `test@${project}.iam.gserviceaccount.com`,
    client_id: "123456789",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

function makeCloudRunConfig(opts: { project?: string; region?: string; repo?: string } = {}) {
  const project = opts.project ?? "my-test-project";
  const auth = new GcpAuth(makeServiceAccountKey(project));
  return {
    auth,
    project,
    region: opts.region ?? "us-central1",
    artifactRegistry: opts.repo ?? "my-ar-repo",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("integration: CloudRunRuntime (no Docker/GCP required)", { timeout: 30_000 }, () => {

  // ── constructor ────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("instantiates without throwing when given a valid config", () => {
      expect(() => new CloudRunRuntime(makeCloudRunConfig())).not.toThrow();
    });

    it("accepts optional serviceAccount field", () => {
      const config = {
        ...makeCloudRunConfig(),
        serviceAccount: "my-sa@project.iam.gserviceaccount.com",
      };
      expect(() => new CloudRunRuntime(config)).not.toThrow();
    });

    it("accepts different region values", () => {
      expect(() => new CloudRunRuntime(makeCloudRunConfig({ region: "europe-west1" }))).not.toThrow();
      expect(() => new CloudRunRuntime(makeCloudRunConfig({ region: "asia-southeast1" }))).not.toThrow();
    });
  });

  // ── needsGateway ─────────────────────────────────────────────────────────

  describe("needsGateway", () => {
    it("is true — Cloud Run agents need gateway for communication", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      expect(rt.needsGateway).toBe(true);
    });

    it("is a boolean", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      expect(typeof rt.needsGateway).toBe("boolean");
    });

    it("is true regardless of project or region", () => {
      const rt1 = new CloudRunRuntime(makeCloudRunConfig({ project: "proj-a", region: "us-central1" }));
      const rt2 = new CloudRunRuntime(makeCloudRunConfig({ project: "proj-b", region: "europe-west1" }));
      expect(rt1.needsGateway).toBe(true);
      expect(rt2.needsGateway).toBe(true);
    });
  });

  // ── getTaskUrl() ──────────────────────────────────────────────────────────

  describe("getTaskUrl()", () => {
    it("returns a string (non-null, non-undefined)", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const url = rt.getTaskUrl("my-run-id");
      expect(url).not.toBeNull();
      expect(url).not.toBeUndefined();
      expect(typeof url).toBe("string");
    });

    it("includes the project name in the URL", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig({ project: "special-project-xyz" }));
      const url = rt.getTaskUrl("run-123");
      expect(url).toContain("special-project-xyz");
    });

    it("includes the region in the URL", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig({ region: "europe-west4" }));
      const url = rt.getTaskUrl("run-456");
      expect(url).toContain("europe-west4");
    });

    it("includes the runId in the URL", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const url = rt.getTaskUrl("my-specific-run-id-789");
      expect(url).toContain("my-specific-run-id-789");
    });

    it("returns a GCP Cloud Console URL (starts with https://console.cloud.google.com)", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const url = rt.getTaskUrl("run-abc");
      expect(url).toMatch(/^https:\/\/console\.cloud\.google\.com/);
    });

    it("contains /run/jobs/details/ path segment", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const url = rt.getTaskUrl("test-run");
      expect(url).toContain("/run/jobs/details/");
    });

    it("two runtimes with different configs produce different URLs for same runId", () => {
      const rt1 = new CloudRunRuntime(makeCloudRunConfig({ project: "project-one", region: "us-central1" }));
      const rt2 = new CloudRunRuntime(makeCloudRunConfig({ project: "project-two", region: "us-east1" }));
      const url1 = rt1.getTaskUrl("same-run-id");
      const url2 = rt2.getTaskUrl("same-run-id");
      expect(url1).not.toBe(url2);
    });
  });

  // ── cleanupCredentials() ──────────────────────────────────────────────────

  describe("cleanupCredentials()", () => {
    it("is a no-op for non-secret-manager strategy (does not throw)", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const otherCreds = { strategy: "container", volumes: [] };
      expect(() => rt.cleanupCredentials(otherCreds as any)).not.toThrow();
    });

    it("is a no-op for host-user strategy", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const hostUserCreds = { strategy: "host-user", stagingDir: "/tmp/test", bundle: {} };
      expect(() => rt.cleanupCredentials(hostUserCreds as any)).not.toThrow();
    });

    it("does not throw for secret-manager strategy with empty secretRefs", () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      // Even though this calls deleteSecret internally, it catches errors
      // (best-effort cleanup). With empty secretRefs, nothing happens.
      const secretCreds = { strategy: "secret-manager", secretRefs: [], bundle: {} };
      expect(() => rt.cleanupCredentials(secretCreds as any)).not.toThrow();
    });
  });

  // ── inspectContainer() ───────────────────────────────────────────────────

  describe("inspectContainer()", () => {
    it("returns null (Cloud Run Jobs do not support container-level inspect)", async () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const result = await rt.inspectContainer("some-container-name");
      expect(result).toBeNull();
    });

    it("returns null regardless of the container name", async () => {
      const rt = new CloudRunRuntime(makeCloudRunConfig());
      const r1 = await rt.inspectContainer("container-a");
      const r2 = await rt.inspectContainer("container-b");
      expect(r1).toBeNull();
      expect(r2).toBeNull();
    });
  });
});
