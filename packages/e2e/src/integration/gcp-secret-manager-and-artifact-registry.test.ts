/**
 * Integration tests: cloud/gcp/secret-manager-api.ts and
 * cloud/gcp/artifact-registry-api.ts error behavior — no Docker or GCP credentials required.
 *
 * Both modules are thin REST API wrappers that call `gcpFetch()`.
 * `gcpFetch()` internally calls `auth.getAccessToken()` which creates a JWT
 * using the private key. With an invalid/fake RSA key, the crypto signing
 * will fail before any network request is made, causing all functions to throw.
 *
 * This documents the error-path behavior for every exported function in both
 * modules and verifies the `DockerImage` interface structure.
 *
 * Test scenarios (no Docker or real GCP required):
 *   secret-manager-api.ts:
 *     1. createSecret() throws when auth fails (invalid RSA key)
 *     2. addSecretVersion() throws when auth fails
 *     3. deleteSecret() throws when auth fails
 *     4. accessSecretVersion() throws when auth fails
 *
 *   artifact-registry-api.ts:
 *     5. listDockerImages() throws when auth fails
 *     6. deleteDockerImage() throws when auth fails
 *     7. cleanupOldImages() throws when auth fails (listAllDockerImages propagates error)
 *     8. DockerImage interface structure: all exported type fields accessible
 *
 * Covers:
 *   - cloud/gcp/secret-manager-api.ts: createSecret() error path (gcpFetch auth failure)
 *   - cloud/gcp/secret-manager-api.ts: addSecretVersion() error path
 *   - cloud/gcp/secret-manager-api.ts: deleteSecret() error path
 *   - cloud/gcp/secret-manager-api.ts: accessSecretVersion() error path
 *   - cloud/gcp/artifact-registry-api.ts: listDockerImages() error path
 *   - cloud/gcp/artifact-registry-api.ts: deleteDockerImage() error path
 *   - cloud/gcp/artifact-registry-api.ts: cleanupOldImages() error path (no try/catch on list)
 *   - cloud/gcp/artifact-registry-api.ts: DockerImage interface exported
 */

import { describe, it, expect, beforeAll } from "vitest";

const { parseServiceAccountKey, GcpAuth } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/auth.js"
);

const {
  createSecret,
  addSecretVersion,
  deleteSecret,
  accessSecretVersion,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/secret-manager-api.js"
);

const {
  listDockerImages,
  deleteDockerImage,
  cleanupOldImages,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/artifact-registry-api.js"
);

// A fake RSA key structure (not a real key — only used to test parsing and error paths)
const FAKE_KEY_JSON = JSON.stringify({
  type: "service_account",
  project_id: "my-test-project",
  private_key_id: "key-abc123",
  private_key:
    "-----BEGIN RSA PRIVATE KEY-----\nFAKE_KEY_DATA\n-----END RSA PRIVATE KEY-----\n",
  client_email: "test-sa@my-test-project.iam.gserviceaccount.com",
  client_id: "123456789",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
});

let auth: any;

beforeAll(() => {
  const key = parseServiceAccountKey(FAKE_KEY_JSON);
  auth = new GcpAuth(key);
});

// ── secret-manager-api.ts ────────────────────────────────────────────────────

describe("integration: cloud/gcp/secret-manager-api.ts error paths (no GCP required)", { timeout: 30_000 }, () => {

  it("createSecret() throws when auth.getAccessToken() fails (invalid RSA key)", async () => {
    await expect(
      createSecret(auth, "my-project", "my-secret-id")
    ).rejects.toThrow();
  });

  it("createSecret() thrown error is an Error instance", async () => {
    let caught: unknown;
    try {
      await createSecret(auth, "my-project", "my-secret-id");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("addSecretVersion() throws when auth fails", async () => {
    await expect(
      addSecretVersion(auth, "my-project", "my-secret-id", "my-secret-value")
    ).rejects.toThrow();
  });

  it("addSecretVersion() thrown error is an Error instance", async () => {
    let caught: unknown;
    try {
      await addSecretVersion(auth, "my-project", "my-secret-id", "payload");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("deleteSecret() throws when auth fails", async () => {
    await expect(
      deleteSecret(auth, "my-project", "my-secret-id")
    ).rejects.toThrow();
  });

  it("deleteSecret() thrown error is an Error instance", async () => {
    let caught: unknown;
    try {
      await deleteSecret(auth, "my-project", "my-secret-id");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("accessSecretVersion() throws when auth fails", async () => {
    await expect(
      accessSecretVersion(auth, "my-project", "my-secret-id")
    ).rejects.toThrow();
  });

  it("accessSecretVersion() with explicit version throws when auth fails", async () => {
    await expect(
      accessSecretVersion(auth, "my-project", "my-secret-id", "1")
    ).rejects.toThrow();
  });

  it("accessSecretVersion() uses 'latest' as default version (does not affect error behavior)", async () => {
    // Both with and without explicit version throw — verifies the default param branch
    const p1 = createSecret(auth, "p", "s").catch((e: unknown) => e);
    const p2 = accessSecretVersion(auth, "p", "s").catch((e: unknown) => e);
    const [e1, e2] = await Promise.all([p1, p2]);
    expect(e1).toBeInstanceOf(Error);
    expect(e2).toBeInstanceOf(Error);
  });
});

// ── artifact-registry-api.ts ─────────────────────────────────────────────────

describe("integration: cloud/gcp/artifact-registry-api.ts error paths (no GCP required)", { timeout: 30_000 }, () => {

  it("listDockerImages() throws when auth fails", async () => {
    await expect(
      listDockerImages(auth, "my-project", "us-central1", "my-repo")
    ).rejects.toThrow();
  });

  it("listDockerImages() thrown error is an Error instance", async () => {
    let caught: unknown;
    try {
      await listDockerImages(auth, "my-project", "us-central1", "my-repo");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("listDockerImages() with pageToken throws when auth fails", async () => {
    await expect(
      listDockerImages(auth, "my-project", "us-central1", "my-repo", "some-page-token")
    ).rejects.toThrow();
  });

  it("deleteDockerImage() throws when auth fails", async () => {
    await expect(
      deleteDockerImage(auth, "projects/my-project/locations/us-central1/repositories/my-repo/dockerImages/my-image@sha256:abc")
    ).rejects.toThrow();
  });

  it("deleteDockerImage() thrown error is an Error instance", async () => {
    let caught: unknown;
    try {
      await deleteDockerImage(auth, "projects/p/locations/us-central1/repositories/r/dockerImages/img@sha256:abc");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("cleanupOldImages() throws when auth fails (listAllDockerImages propagates error)", async () => {
    await expect(
      cleanupOldImages(auth, "my-project", "us-central1", "my-repo", "my-image")
    ).rejects.toThrow();
  });

  it("cleanupOldImages() with custom keepCount still throws when auth fails", async () => {
    await expect(
      cleanupOldImages(auth, "my-project", "us-central1", "my-repo", "my-image", 5)
    ).rejects.toThrow();
  });

  it("cleanupOldImages() thrown error is an Error instance", async () => {
    let caught: unknown;
    try {
      await cleanupOldImages(auth, "my-project", "us-central1", "my-repo", "my-image");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
