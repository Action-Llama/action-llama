/**
 * Integration tests: cloud/gcp/cloud-run-api.ts error paths — no GCP credentials required.
 *
 * All exported functions call `gcpFetch()` which calls `auth.getAccessToken()`.
 * With an invalid/fake RSA key, the JWT signing fails before any network
 * request is made, causing all functions to throw.
 *
 * This documents the error-path behavior for every exported function and
 * verifies the interface structure for exported types.
 *
 * Test scenarios:
 *   1. createJob() throws when auth fails
 *   2. getJob() throws when auth fails
 *   3. deleteJob() throws when auth fails
 *   4. runJob() throws when auth fails
 *   5. getExecution() throws when auth fails
 *   6. listExecutions() throws when auth fails
 *   7. listJobs() throws when auth fails
 *   8. All thrown errors are Error instances
 *   9. GcpApiError class (re-exported) has correct statusCode
 *
 * Covers:
 *   - cloud/gcp/cloud-run-api.ts: createJob() error path (auth failure)
 *   - cloud/gcp/cloud-run-api.ts: getJob() error path
 *   - cloud/gcp/cloud-run-api.ts: deleteJob() error path
 *   - cloud/gcp/cloud-run-api.ts: runJob() error path
 *   - cloud/gcp/cloud-run-api.ts: getExecution() error path
 *   - cloud/gcp/cloud-run-api.ts: listExecutions() error path
 *   - cloud/gcp/cloud-run-api.ts: listJobs() error path
 *   - cloud/gcp/cloud-run-api.ts: gcpFetch() auth failure propagation
 *   - cloud/gcp/cloud-run-api.ts: pollExecutionUntilDone() timeout path (timeoutMs=0)
 *   - cloud/gcp/cloud-run-api.ts: pollExecutionUntilDone() error path (auth failure)
 */

import { describe, it, expect, beforeAll } from "vitest";

const { parseServiceAccountKey, GcpAuth } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/auth.js"
);

const {
  GcpApiError,
  createJob,
  getJob,
  deleteJob,
  runJob,
  getExecution,
  listExecutions,
  listJobs,
  pollExecutionUntilDone,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/gcp/cloud-run-api.js"
);

// A fake RSA key structure — not a real key, only used to test error paths.
// The JWT signing will fail because the RSA key data is invalid.
const FAKE_KEY_JSON = JSON.stringify({
  type: "service_account",
  project_id: "my-test-project",
  private_key_id: "key-abc123",
  private_key:
    "-----BEGIN RSA PRIVATE KEY-----\nFAKEKEYDATAFAKEKEYDATA\n-----END RSA PRIVATE KEY-----\n",
  client_email: "test-sa@my-test-project.iam.gserviceaccount.com",
  client_id: "123456789",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
});

const FAKE_PROJECT = "my-test-project";
const FAKE_REGION = "us-central1";
const FAKE_JOB_ID = "my-test-job";
const FAKE_EXECUTION_ID = "my-test-execution-00001-abc";

let auth: any;

beforeAll(() => {
  const key = parseServiceAccountKey(FAKE_KEY_JSON);
  auth = new GcpAuth(key);
});

describe(
  "integration: cloud/gcp/cloud-run-api.ts error paths (no GCP required)",
  { timeout: 30_000 },
  () => {
    // ── GcpApiError ───────────────────────────────────────────────────────────

    describe("GcpApiError class", () => {
      it("is constructible with statusCode and message", () => {
        const err = new GcpApiError(404, "not found");
        expect(err.name).toBe("GcpApiError");
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe("not found");
      });

      it("is an instance of Error", () => {
        const err = new GcpApiError(500, "server error");
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(GcpApiError);
      });
    });

    // ── createJob ──────────────────────────────────────────────────────────────

    it("createJob() throws when auth.getAccessToken() fails (invalid RSA key)", async () => {
      const template = {
        containers: [{ image: "gcr.io/my-project/my-image:latest" }],
        maxRetries: 1,
      };
      await expect(
        createJob(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID, template)
      ).rejects.toThrow();
    });

    it("createJob() thrown error is an Error instance", async () => {
      let caught: unknown;
      try {
        await createJob(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID, {
          containers: [],
          maxRetries: 0,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });

    // ── getJob ────────────────────────────────────────────────────────────────

    it("getJob() throws when auth fails", async () => {
      await expect(
        getJob(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID)
      ).rejects.toThrow();
    });

    it("getJob() thrown error is an Error instance", async () => {
      let caught: unknown;
      try {
        await getJob(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });

    // ── deleteJob ─────────────────────────────────────────────────────────────

    it("deleteJob() throws when auth fails", async () => {
      await expect(
        deleteJob(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID)
      ).rejects.toThrow();
    });

    // ── runJob ────────────────────────────────────────────────────────────────

    it("runJob() throws when auth fails", async () => {
      await expect(
        runJob(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID)
      ).rejects.toThrow();
    });

    // ── getExecution ──────────────────────────────────────────────────────────

    it("getExecution() throws when auth fails", async () => {
      await expect(
        getExecution(auth, FAKE_PROJECT, FAKE_REGION, FAKE_EXECUTION_ID)
      ).rejects.toThrow();
    });

    // ── listExecutions ────────────────────────────────────────────────────────

    it("listExecutions() throws when auth fails", async () => {
      await expect(
        listExecutions(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID)
      ).rejects.toThrow();
    });

    it("listExecutions() thrown error is an Error instance", async () => {
      let caught: unknown;
      try {
        await listExecutions(auth, FAKE_PROJECT, FAKE_REGION, FAKE_JOB_ID);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });

    // ── listJobs ──────────────────────────────────────────────────────────────

    it("listJobs() throws when auth fails", async () => {
      await expect(
        listJobs(auth, FAKE_PROJECT, FAKE_REGION)
      ).rejects.toThrow();
    });

    it("listJobs() thrown error is an Error instance", async () => {
      let caught: unknown;
      try {
        await listJobs(auth, FAKE_PROJECT, FAKE_REGION);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });

    // ── pollExecutionUntilDone ──────────────────────────────────────────────

    it("pollExecutionUntilDone() throws immediately when timeoutMs=0 (deadline already passed)", async () => {
      // With timeoutMs=0, the while condition is false immediately → throws timeout error
      await expect(
        pollExecutionUntilDone(auth, FAKE_PROJECT, FAKE_REGION, "fake-execution-001", 0)
      ).rejects.toThrow(/timed out/i);
    });

    it("pollExecutionUntilDone() timeout error message includes execution name", async () => {
      let caught: Error | undefined;
      try {
        await pollExecutionUntilDone(auth, FAKE_PROJECT, FAKE_REGION, "my-special-execution", 0);
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("my-special-execution");
    });

    it("pollExecutionUntilDone() timeout error message includes timeoutMs", async () => {
      let caught: Error | undefined;
      try {
        await pollExecutionUntilDone(auth, FAKE_PROJECT, FAKE_REGION, "my-execution", 0);
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("0ms");
    });

    it("pollExecutionUntilDone() throws when auth fails (timeoutMs=30000)", async () => {
      // With invalid auth, getExecution() throws before the deadline check
      await expect(
        pollExecutionUntilDone(auth, FAKE_PROJECT, FAKE_REGION, "fake-exec", 30_000)
      ).rejects.toThrow();
    });

    it("pollExecutionUntilDone() thrown error is an Error instance when auth fails", async () => {
      let caught: unknown;
      try {
        await pollExecutionUntilDone(auth, FAKE_PROJECT, FAKE_REGION, "fake-exec", 30_000);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });
  },
);
