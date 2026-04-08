/**
 * Integration tests: docker/providers/index.ts — no Docker required.
 *
 * docker/providers/index.ts exports three RuntimeExtension objects:
 *   1. localDockerExtension — Local Docker runtime
 *   2. sshDockerExtension — SSH Docker runtime
 *   3. cloudRunDockerExtension — Google Cloud Run Jobs runtime
 *
 * These extension objects have metadata and init/shutdown lifecycle methods
 * that are called by the ExtensionRegistry during scheduler startup.
 *
 * Test scenarios (no Docker required):
 *   1. localDockerExtension metadata fields (name, type, version, description)
 *   2. localDockerExtension has provider instance
 *   3. localDockerExtension init() does not throw
 *   4. localDockerExtension shutdown() does not throw
 *   5. sshDockerExtension metadata fields
 *   6. sshDockerExtension has provider instance
 *   7. sshDockerExtension init() does not throw
 *   8. sshDockerExtension shutdown() does not throw
 *   9. cloudRunDockerExtension metadata fields
 *  10. cloudRunDockerExtension init() without config → provider stays null
 *  11. cloudRunDockerExtension shutdown() does not throw
 *  12. All three extensions exported from the module
 *
 * Covers:
 *   - docker/providers/index.ts: localDockerExtension — metadata + init + shutdown
 *   - docker/providers/index.ts: sshDockerExtension — metadata + init + shutdown
 *   - docker/providers/index.ts: cloudRunDockerExtension — metadata + init(no-config) + shutdown
 */

import { describe, it, expect } from "vitest";

const {
  localDockerExtension,
  sshDockerExtension,
  cloudRunDockerExtension,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/providers/index.js"
);

describe("integration: docker/providers/index.ts (no Docker required)", { timeout: 30_000 }, () => {

  // ── localDockerExtension ──────────────────────────────────────────────────

  it("localDockerExtension is defined", () => {
    expect(localDockerExtension).toBeDefined();
  });

  it("localDockerExtension metadata.name is 'local'", () => {
    expect(localDockerExtension.metadata.name).toBe("local");
  });

  it("localDockerExtension metadata.type is 'runtime'", () => {
    expect(localDockerExtension.metadata.type).toBe("runtime");
  });

  it("localDockerExtension metadata.version is defined", () => {
    expect(typeof localDockerExtension.metadata.version).toBe("string");
  });

  it("localDockerExtension metadata.description is non-empty", () => {
    expect(localDockerExtension.metadata.description).toBeTruthy();
  });

  it("localDockerExtension metadata.requiredCredentials is empty array", () => {
    const creds = localDockerExtension.metadata.requiredCredentials || [];
    expect(Array.isArray(creds)).toBe(true);
    expect(creds.length).toBe(0);
  });

  it("localDockerExtension provider is defined", () => {
    expect(localDockerExtension.provider).toBeDefined();
  });

  it("localDockerExtension init() does not throw", async () => {
    await expect(localDockerExtension.init()).resolves.toBeUndefined();
  });

  it("localDockerExtension shutdown() does not throw", async () => {
    await expect(localDockerExtension.shutdown()).resolves.toBeUndefined();
  });

  // ── sshDockerExtension ────────────────────────────────────────────────────

  it("sshDockerExtension is defined", () => {
    expect(sshDockerExtension).toBeDefined();
  });

  it("sshDockerExtension metadata.name is 'ssh'", () => {
    expect(sshDockerExtension.metadata.name).toBe("ssh");
  });

  it("sshDockerExtension metadata.type is 'runtime'", () => {
    expect(sshDockerExtension.metadata.type).toBe("runtime");
  });

  it("sshDockerExtension has provider instance", () => {
    expect(sshDockerExtension.provider).toBeDefined();
  });

  it("sshDockerExtension metadata.requiredCredentials has entries", () => {
    const creds = sshDockerExtension.metadata.requiredCredentials || [];
    expect(creds.length).toBeGreaterThan(0);
  });

  it("sshDockerExtension metadata.providesCredentialTypes includes ssh_host", () => {
    const types = sshDockerExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "ssh_host")).toBe(true);
  });

  it("sshDockerExtension init() does not throw", async () => {
    await expect(sshDockerExtension.init()).resolves.toBeUndefined();
  });

  it("sshDockerExtension shutdown() does not throw", async () => {
    await expect(sshDockerExtension.shutdown()).resolves.toBeUndefined();
  });

  // ── cloudRunDockerExtension ───────────────────────────────────────────────

  it("cloudRunDockerExtension is defined", () => {
    expect(cloudRunDockerExtension).toBeDefined();
  });

  it("cloudRunDockerExtension metadata.name is 'cloud-run'", () => {
    expect(cloudRunDockerExtension.metadata.name).toBe("cloud-run");
  });

  it("cloudRunDockerExtension metadata.type is 'runtime'", () => {
    expect(cloudRunDockerExtension.metadata.type).toBe("runtime");
  });

  it("cloudRunDockerExtension metadata.description contains 'Cloud Run'", () => {
    expect(cloudRunDockerExtension.metadata.description).toContain("Cloud Run");
  });

  it("cloudRunDockerExtension metadata.requiredCredentials includes gcp_service_account", () => {
    const creds = cloudRunDockerExtension.metadata.requiredCredentials || [];
    expect(creds.some((c: any) => c.type === "gcp_service_account")).toBe(true);
  });

  it("cloudRunDockerExtension init() without config leaves provider null", async () => {
    // Without keyJson/project/region/artifactRegistry, init is a no-op
    await expect(cloudRunDockerExtension.init(undefined)).resolves.toBeUndefined();
    // Provider should remain null (not configured)
    expect(cloudRunDockerExtension.provider).toBeNull();
  });

  it("cloudRunDockerExtension shutdown() does not throw", async () => {
    await expect(cloudRunDockerExtension.shutdown()).resolves.toBeUndefined();
  });

  // ── All extensions exported ───────────────────────────────────────────────

  it("all three extensions are defined and distinct", () => {
    expect(localDockerExtension).toBeDefined();
    expect(sshDockerExtension).toBeDefined();
    expect(cloudRunDockerExtension).toBeDefined();
    expect(localDockerExtension).not.toBe(sshDockerExtension);
    expect(localDockerExtension).not.toBe(cloudRunDockerExtension);
    expect(sshDockerExtension).not.toBe(cloudRunDockerExtension);
  });
});
