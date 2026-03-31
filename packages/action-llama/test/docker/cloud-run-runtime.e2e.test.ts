/**
 * End-to-end integration tests for the Cloud Run Jobs runtime.
 *
 * These tests verify the full lifecycle of the CloudRunRuntime:
 *   prepareCredentials → launch → streamLogs → waitForExit → cleanupCredentials
 *
 * All GCP API calls are mocked to avoid requiring a real GCP project.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock all GCP API modules ─────────────────────────────────────────────────

vi.mock("../../src/cloud/gcp/cloud-run-api.js", () => ({
  createJob: vi.fn().mockResolvedValue({ name: "operations/create" }),
  deleteJob: vi.fn().mockResolvedValue({ name: "operations/delete" }),
  runJob: vi.fn().mockResolvedValue({
    name: "operations/run",
    response: { name: "projects/test-proj/locations/us-central1/jobs/al-testagent-run1/executions/exec-1" },
  }),
  listJobs: vi.fn().mockResolvedValue([]),
  listExecutions: vi.fn().mockResolvedValue([]),
  pollExecutionUntilDone: vi.fn().mockResolvedValue({
    name: "exec-1",
    uid: "uid1",
    createTime: "2026-01-01T00:00:00Z",
    completionTime: "2026-01-01T01:00:00Z",
    conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
  }),
}));

vi.mock("../../src/cloud/gcp/secret-manager-api.js", () => ({
  createSecret: vi.fn().mockResolvedValue({ name: "projects/test-proj/secrets/my-secret" }),
  addSecretVersion: vi.fn().mockResolvedValue({ name: "projects/test-proj/secrets/my-secret/versions/1" }),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/cloud/gcp/logging-api.js", () => ({
  listLogEntries: vi.fn().mockResolvedValue({
    entries: [
      { textPayload: "[agent] Starting up", timestamp: "2026-01-01T00:00:01Z" },
      { textPayload: "[agent] Processing webhook", timestamp: "2026-01-01T00:00:02Z" },
      { textPayload: "[agent] Done. Exiting.", timestamp: "2026-01-01T00:00:03Z" },
    ],
  }),
  buildJobLogFilter: vi.fn().mockReturnValue("resource.type=\"cloud_run_job\""),
  extractLogText: vi.fn().mockImplementation((entry: any) => entry.textPayload ?? ""),
}));

vi.mock("../../src/cloud/gcp/artifact-registry-api.js", () => ({
  cleanupOldImages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: vi.fn().mockImplementation((ref: string) => {
    const [type, instance = "default"] = ref.split("/");
    return { type, instance };
  }),
  getDefaultBackend: vi.fn().mockReturnValue({
    readAll: vi.fn().mockResolvedValue({
      token: "ghp_test_token_123",
      expiry: "2030-01-01",
    }),
  }),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { CloudRunRuntime } from "../../src/docker/cloud-run-runtime.js";
import type { GcpAuth } from "../../src/cloud/gcp/auth.js";
import {
  createJob,
  deleteJob,
  runJob,
  listJobs,
  listExecutions,
  pollExecutionUntilDone,
} from "../../src/cloud/gcp/cloud-run-api.js";
import {
  createSecret,
  addSecretVersion,
  deleteSecret,
} from "../../src/cloud/gcp/secret-manager-api.js";
import { listLogEntries } from "../../src/cloud/gcp/logging-api.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeMockAuth(): GcpAuth {
  return {
    getAccessToken: vi.fn().mockResolvedValue("ya29.mock-access-token"),
  } as any;
}

function makeRuntime() {
  return new CloudRunRuntime({
    auth: makeMockAuth(),
    project: "test-proj",
    region: "us-central1",
    artifactRegistry: "test-repo",
    serviceAccount: "agent@test-proj.iam.gserviceaccount.com",
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CloudRunRuntime E2E lifecycle", () => {
  let runtime: CloudRunRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = makeRuntime();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("full agent run lifecycle", () => {
    it("prepareCredentials → launch → waitForExit → cleanupCredentials", async () => {
      // 1. Prepare credentials
      const creds = await runtime.prepareCredentials(["github_token/default"]);

      expect(creds.strategy).toBe("secret-manager");
      if (creds.strategy !== "secret-manager") throw new Error("wrong strategy");

      // Each credential field should be a separate secret
      expect(creds.secretRefs.length).toBeGreaterThan(0);
      for (const ref of creds.secretRefs) {
        expect(ref.secretName).toBeTruthy();
        expect(ref.mountPath).toMatch(/^\/credentials\/github_token\/default\//);
      }

      // Secret Manager APIs were called
      expect(createSecret).toHaveBeenCalled();
      expect(addSecretVersion).toHaveBeenCalled();

      // 2. Launch
      const jobId = await runtime.launch({
        image: "us-central1-docker.pkg.dev/test-proj/test-repo/my-agent:v1.0.0",
        agentName: "testagent",
        env: {
          GATEWAY_URL: "https://gw.example.com",
          SHUTDOWN_SECRET: "super-secret",
          PROMPT: "Process this webhook",
        },
        credentials: creds,
        memory: "2g",
        cpus: 1,
      });

      expect(jobId).toMatch(/^al-testagent-/);
      expect(createJob).toHaveBeenCalledOnce();
      expect(runJob).toHaveBeenCalledOnce();

      // Verify job config
      const [, , , , template] = vi.mocked(createJob).mock.calls[0];
      expect(template.template.maxRetries).toBe(0);
      expect(template.template.containers[0].image).toBe(
        "us-central1-docker.pkg.dev/test-proj/test-repo/my-agent:v1.0.0",
      );
      expect(template.template.containers[0].resources?.limits?.memory).toBe("2Gi");
      expect(template.labels?.["started-by"]).toBe("action-llama");
      expect(template.labels?.["agent-name"]).toBe("testagent");

      // Volumes should be set up for secret-manager credentials
      if (creds.secretRefs.length > 0) {
        expect(template.template.volumes).toBeDefined();
        expect(template.template.volumes!.length).toBeGreaterThan(0);
      }

      // 3. Wait for exit
      (runtime as any).executionNames.set(
        jobId,
        "projects/test-proj/locations/us-central1/jobs/al-testagent-run1/executions/exec-1",
      );
      const exitCode = await runtime.waitForExit(jobId, 3600);
      expect(exitCode).toBe(0);
      expect(pollExecutionUntilDone).toHaveBeenCalledOnce();

      // 4. Cleanup credentials
      runtime.cleanupCredentials(creds);
      await new Promise((r) => setTimeout(r, 20));
      expect(deleteSecret).toHaveBeenCalledTimes(creds.secretRefs.length);
    });
  });

  describe("log streaming integration", () => {
    it("streamLogs delivers log lines and can be stopped", async () => {
      vi.useFakeTimers();

      const lines: string[] = [];
      const handle = runtime.streamLogs("al-testagent-run1", (line) => lines.push(line));

      // Advance timer to trigger first poll
      await vi.advanceTimersByTimeAsync(3500);

      // Check log entries were fetched
      expect(listLogEntries).toHaveBeenCalled();

      // Stop polling
      handle.stop();

      // Advance timer — no more calls should happen
      const callsAfterStop = vi.mocked(listLogEntries).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);
      expect(vi.mocked(listLogEntries).mock.calls.length).toBe(callsAfterStop);

      vi.useRealTimers();
    });
  });

  describe("orphan recovery", () => {
    it("listRunningAgents returns running agents from Cloud Run", async () => {
      vi.mocked(listJobs).mockResolvedValueOnce([
        {
          name: "projects/test-proj/locations/us-central1/jobs/al-myagent-abc12345",
          uid: "job-uid",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [{ image: "img" }] } },
        },
      ]);
      vi.mocked(listExecutions).mockResolvedValueOnce([
        {
          name: "projects/test-proj/locations/us-central1/jobs/al-myagent-abc12345/executions/exec1",
          uid: "exec-uid",
          createTime: "2026-01-01T00:00:00Z",
          // No completionTime = still running
        },
      ]);

      const agents = await runtime.listRunningAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentName).toBe("myagent");
      expect(agents[0].runtimeId).toBe("al-myagent-abc12345");
      expect(agents[0].status).toBe("running");
    });

    it("inspectContainer returns null (Cloud Run Jobs do not expose environment)", async () => {
      const result = await runtime.inspectContainer("al-myagent-abc12345");
      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    it("kill does not throw even if job deletion fails", async () => {
      vi.mocked(deleteJob).mockRejectedValueOnce(new Error("Job not found"));
      await expect(runtime.kill("al-myagent-abc12345")).resolves.toBeUndefined();
    });

    it("waitForExit throws when no execution is tracked for the job", async () => {
      await expect(runtime.waitForExit("al-unknown-job", 3600)).rejects.toThrow(
        "No execution found",
      );
    });

    it("prepareCredentials skips fields that fail to create secrets", async () => {
      vi.mocked(createSecret).mockRejectedValueOnce(new Error("IAM permission denied"));
      vi.mocked(createSecret).mockResolvedValue({}); // subsequent calls succeed

      // Should not throw
      const creds = await runtime.prepareCredentials(["github_token/default"]);
      expect(creds.strategy).toBe("secret-manager");
    });
  });

  describe("multi-agent isolation", () => {
    it("isAgentRunning returns true only for agents with active executions", async () => {
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/test-proj/locations/us-central1/jobs/al-agent-a-abc",
          uid: "uid1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
        {
          name: "projects/test-proj/locations/us-central1/jobs/al-agent-b-def",
          uid: "uid2",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);

      // agent-a has a running execution
      vi.mocked(listExecutions)
        .mockResolvedValueOnce([
          { name: "exec1", uid: "euid1", createTime: "2026-01-01T00:00:00Z" },
        ]);

      const isRunning = await runtime.isAgentRunning("agent-a");
      expect(isRunning).toBe(true);
    });

    it("isAgentRunning returns false when all executions are complete", async () => {
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/test-proj/locations/us-central1/jobs/al-agent-b-def",
          uid: "uid1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);

      // All executions are complete
      vi.mocked(listExecutions).mockResolvedValue([
        {
          name: "exec1",
          uid: "euid1",
          createTime: "2026-01-01T00:00:00Z",
          completionTime: "2026-01-01T01:00:00Z", // completed
        },
      ]);

      const isRunning = await runtime.isAgentRunning("agent-b");
      expect(isRunning).toBe(false);
    });
  });
});
