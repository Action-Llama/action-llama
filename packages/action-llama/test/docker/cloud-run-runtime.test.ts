import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all GCP API modules
vi.mock("../../src/cloud/gcp/cloud-run-api.js", () => ({
  createJob: vi.fn().mockResolvedValue({ name: "operations/create" }),
  deleteJob: vi.fn().mockResolvedValue({ name: "operations/delete" }),
  runJob: vi.fn().mockResolvedValue({ name: "operations/run", response: { name: "projects/p/locations/r/jobs/j/executions/e1" } }),
  listJobs: vi.fn().mockResolvedValue([]),
  listExecutions: vi.fn().mockResolvedValue([]),
  getExecution: vi.fn(),
  pollExecutionUntilDone: vi.fn().mockResolvedValue({
    name: "executions/e1",
    uid: "uid1",
    createTime: "2026-01-01T00:00:00Z",
    completionTime: "2026-01-01T01:00:00Z",
    conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
  }),
}));

vi.mock("../../src/cloud/gcp/secret-manager-api.js", () => ({
  createSecret: vi.fn().mockResolvedValue({}),
  addSecretVersion: vi.fn().mockResolvedValue({}),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/cloud/gcp/logging-api.js", () => ({
  listLogEntries: vi.fn().mockResolvedValue({ entries: [] }),
  buildJobLogFilter: vi.fn().mockReturnValue("filter=test"),
  extractLogText: vi.fn().mockReturnValue("log line"),
}));

vi.mock("../../src/cloud/gcp/artifact-registry-api.js", () => ({
  cleanupOldImages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: vi.fn().mockReturnValue({ type: "github_token", instance: "default" }),
  getDefaultBackend: vi.fn().mockReturnValue({
    readAll: vi.fn().mockResolvedValue({ api_key: "my-secret-value" }),
  }),
}));

import { CloudRunRuntime } from "../../src/docker/cloud-run-runtime.js";
import type { GcpAuth } from "../../src/cloud/gcp/auth.js";
import { createJob, deleteJob, runJob, listJobs, listExecutions, pollExecutionUntilDone } from "../../src/cloud/gcp/cloud-run-api.js";
import { createSecret, addSecretVersion, deleteSecret } from "../../src/cloud/gcp/secret-manager-api.js";

const mockAuth: GcpAuth = {
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
} as any;

function makeRuntime() {
  return new CloudRunRuntime({
    auth: mockAuth,
    project: "my-project",
    region: "us-central1",
    artifactRegistry: "my-repo",
    serviceAccount: "agent@my-project.iam.gserviceaccount.com",
  });
}

describe("CloudRunRuntime", () => {
  describe("needsGateway", () => {
    it("returns true", () => {
      expect(makeRuntime().needsGateway).toBe(true);
    });
  });

  describe("prepareCredentials", () => {
    beforeEach(() => {
      vi.mocked(createSecret).mockResolvedValue({});
      vi.mocked(addSecretVersion).mockResolvedValue({});
    });

    it("returns strategy: secret-manager", async () => {
      const runtime = makeRuntime();
      const creds = await runtime.prepareCredentials(["github_token/default"]);
      expect(creds.strategy).toBe("secret-manager");
    });

    it("creates Secret Manager secrets for each credential field", async () => {
      const runtime = makeRuntime();
      await runtime.prepareCredentials(["github_token/default"]);
      expect(createSecret).toHaveBeenCalled();
      expect(addSecretVersion).toHaveBeenCalled();
    });

    it("secretRefs have non-empty secretName and mountPath", async () => {
      const runtime = makeRuntime();
      const creds = await runtime.prepareCredentials(["github_token/default"]);
      if (creds.strategy !== "secret-manager") throw new Error("wrong strategy");
      expect(creds.secretRefs.length).toBeGreaterThan(0);
      for (const ref of creds.secretRefs) {
        expect(ref.secretName).toBeTruthy();
        expect(ref.mountPath).toMatch(/^\/credentials\//);
      }
    });

    it("includes bundle with credential values", async () => {
      const runtime = makeRuntime();
      const creds = await runtime.prepareCredentials(["github_token/default"]);
      expect(creds.bundle).toBeDefined();
    });
  });

  describe("cleanupCredentials", () => {
    it("deletes all secrets from secretRefs", async () => {
      vi.mocked(deleteSecret).mockResolvedValue(undefined);
      const runtime = makeRuntime();
      runtime.cleanupCredentials({
        strategy: "secret-manager",
        secretRefs: [
          { secretName: "secret-1", mountPath: "/credentials/t/i/f" },
          { secretName: "secret-2", mountPath: "/credentials/t/i/g" },
        ],
        bundle: {},
      });
      // Allow microtasks to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(deleteSecret).toHaveBeenCalledTimes(2);
    });

    it("does nothing for non-secret-manager strategy", () => {
      const runtime = makeRuntime();
      // Should not throw
      runtime.cleanupCredentials({ strategy: "volume", stagingDir: "/tmp/test", bundle: {} });
    });
  });

  describe("launch", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(createJob).mockResolvedValue({ name: "operations/create" } as any);
      vi.mocked(runJob).mockResolvedValue({ name: "operations/run", response: { name: "projects/p/locations/r/jobs/j/executions/e1" } } as any);
    });

    it("creates a Cloud Run Job and returns a jobId", async () => {
      const runtime = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      const runId = await runtime.launch({
        image: "us-central1-docker.pkg.dev/my-project/my-repo/my-agent:latest",
        agentName: "my-agent",
        env: { GATEWAY_URL: "https://gateway.example.com" },
        credentials: creds,
      });
      expect(runId).toMatch(/^al-my-agent-/);
      expect(createJob).toHaveBeenCalled();
      expect(runJob).toHaveBeenCalled();
    });

    it("passes env vars to the container", async () => {
      const runtime = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await runtime.launch({
        image: "my-image",
        agentName: "myagent",
        env: { KEY1: "value1", KEY2: "value2" },
        credentials: creds,
      });

      const createJobCall = vi.mocked(createJob).mock.calls.at(-1)!;
      const template = createJobCall[4];
      const container = template.template.containers[0];
      const envNames = container.env?.map((e: any) => e.name) ?? [];
      expect(envNames).toContain("KEY1");
      expect(envNames).toContain("KEY2");
    });

    it("sets maxRetries to 0", async () => {
      const runtime = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await runtime.launch({ image: "img", agentName: "agent", env: {}, credentials: creds });

      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.maxRetries).toBe(0);
    });

    it("applies labels with started-by and agent-name", async () => {
      const runtime = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await runtime.launch({ image: "img", agentName: "testagent", env: {}, credentials: creds });

      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.labels?.["started-by"]).toBe("action-llama");
      expect(template.labels?.["agent-name"]).toBe("testagent");
    });
  });

  describe("memory parsing", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(createJob).mockResolvedValue({} as any);
      vi.mocked(runJob).mockResolvedValue({ response: { name: "exec1" } } as any);
    });

    it("converts 4g to 4Gi", async () => {
      const r = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await r.launch({ image: "img", agentName: "a", env: {}, credentials: creds, memory: "4g" });

      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.containers[0].resources?.limits?.memory).toBe("4Gi");
    });

    it("defaults to 2Gi when memory not specified", async () => {
      const r = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await r.launch({ image: "img", agentName: "a", env: {}, credentials: creds });

      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.containers[0].resources?.limits?.memory).toBe("2Gi");
    });
  });

  describe("kill", () => {
    it("deletes the job", async () => {
      vi.mocked(deleteJob).mockResolvedValue({} as any);
      const runtime = makeRuntime();
      await runtime.kill("al-myagent-abc123");
      expect(deleteJob).toHaveBeenCalledWith(mockAuth, "my-project", "us-central1", "al-myagent-abc123");
    });

    it("does not throw when job not found", async () => {
      vi.mocked(deleteJob).mockRejectedValue(new Error("not found"));
      const runtime = makeRuntime();
      await expect(runtime.kill("al-myagent-abc123")).resolves.toBeUndefined();
    });
  });

  describe("remove", () => {
    it("calls kill (deletes the job)", async () => {
      vi.mocked(deleteJob).mockResolvedValue({} as any);
      const runtime = makeRuntime();
      await runtime.remove("al-myagent-abc123");
      expect(deleteJob).toHaveBeenCalled();
    });
  });

  describe("waitForExit", () => {
    it("polls execution and returns 0 on success", async () => {
      vi.mocked(pollExecutionUntilDone).mockResolvedValue({
        name: "exec1",
        uid: "uid1",
        createTime: "2026-01-01T00:00:00Z",
        completionTime: "2026-01-01T01:00:00Z",
        conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
      });

      const runtime = makeRuntime();
      // Manually set the execution name
      (runtime as any).executionNames.set("job1", "projects/p/locations/r/jobs/j/executions/e1");

      const code = await runtime.waitForExit("job1", 3600);
      expect(code).toBe(0);
    });

    it("returns 1 on CONDITION_FAILED without exit code in message", async () => {
      vi.mocked(pollExecutionUntilDone).mockResolvedValue({
        name: "exec1",
        uid: "uid1",
        createTime: "2026-01-01T00:00:00Z",
        completionTime: "2026-01-01T01:00:00Z",
        conditions: [{ type: "Completed", state: "CONDITION_FAILED", message: "Task failed" }],
      });

      const runtime = makeRuntime();
      (runtime as any).executionNames.set("job1", "exec1");
      const code = await runtime.waitForExit("job1", 3600);
      expect(code).toBe(1);
    });

    it("throws when no execution is found for the job", async () => {
      const runtime = makeRuntime();
      await expect(runtime.waitForExit("nonexistent-job", 3600)).rejects.toThrow(
        "No execution found",
      );
    });
  });

  describe("listRunningAgents", () => {
    it("returns empty array when no jobs", async () => {
      vi.mocked(listJobs).mockResolvedValue([]);
      const runtime = makeRuntime();
      const agents = await runtime.listRunningAgents();
      expect(agents).toEqual([]);
    });

    it("filters by CONTAINER_FILTER prefix", async () => {
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/my-project/locations/us-central1/jobs/al-myagent-abc",
          uid: "uid1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
        {
          name: "projects/my-project/locations/us-central1/jobs/other-job",
          uid: "uid2",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);
      vi.mocked(listExecutions).mockResolvedValue([
        { name: "exec1", uid: "euid1", createTime: "2026-01-01T00:00:00Z" },
      ]);

      const runtime = makeRuntime();
      const agents = await runtime.listRunningAgents();
      // Only al-myagent-abc matches the filter (other-job doesn't start with "al-")
      expect(agents.length).toBe(1);
      expect(agents[0].agentName).toBe("myagent");
    });
  });

  describe("isAgentRunning", () => {
    it("returns false when no matching jobs", async () => {
      vi.mocked(listJobs).mockResolvedValue([]);
      const runtime = makeRuntime();
      const result = await runtime.isAgentRunning("myagent");
      expect(result).toBe(false);
    });

    it("returns true when a matching job has a running execution", async () => {
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/my-project/locations/us-central1/jobs/al-myagent-abc",
          uid: "uid1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);
      vi.mocked(listExecutions).mockResolvedValue([
        { name: "exec1", uid: "euid1", createTime: "2026-01-01T00:00:00Z" }, // no completionTime = running
      ]);

      const runtime = makeRuntime();
      const result = await runtime.isAgentRunning("myagent");
      expect(result).toBe(true);
    });
  });

  describe("getTaskUrl", () => {
    it("returns the GCP console URL for the job", () => {
      const runtime = makeRuntime();
      const url = runtime.getTaskUrl("al-myagent-abc123");
      expect(url).toContain("console.cloud.google.com/run/jobs");
      expect(url).toContain("al-myagent-abc123");
      expect(url).toContain("my-project");
      expect(url).toContain("us-central1");
    });
  });

  describe("inspectContainer", () => {
    it("returns null (not supported by Cloud Run Jobs)", async () => {
      const runtime = makeRuntime();
      const result = await runtime.inspectContainer("any-container");
      expect(result).toBeNull();
    });
  });

  describe("implements Runtime and ContainerRuntime interfaces", () => {
    it("has all required Runtime methods", () => {
      const runtime = makeRuntime();
      expect(typeof runtime.needsGateway).toBe("boolean");
      expect(typeof runtime.isAgentRunning).toBe("function");
      expect(typeof runtime.listRunningAgents).toBe("function");
      expect(typeof runtime.launch).toBe("function");
      expect(typeof runtime.streamLogs).toBe("function");
      expect(typeof runtime.waitForExit).toBe("function");
      expect(typeof runtime.kill).toBe("function");
      expect(typeof runtime.remove).toBe("function");
      expect(typeof runtime.prepareCredentials).toBe("function");
      expect(typeof runtime.cleanupCredentials).toBe("function");
      expect(typeof runtime.fetchLogs).toBe("function");
      expect(typeof runtime.followLogs).toBe("function");
      expect(typeof runtime.getTaskUrl).toBe("function");
      expect(typeof runtime.inspectContainer).toBe("function");
    });

    it("has all required ContainerRuntime methods", () => {
      const runtime = makeRuntime();
      expect(typeof runtime.buildImage).toBe("function");
      expect(typeof runtime.pushImage).toBe("function");
    });
  });

  describe("streamLogs", () => {
    it("returns a stop function", () => {
      const runtime = makeRuntime();
      const handle = runtime.streamLogs("job1", () => {});
      expect(typeof handle.stop).toBe("function");
      handle.stop();
    });
  });

  describe("followLogs", () => {
    it("returns a stop function", () => {
      const runtime = makeRuntime();
      const handle = runtime.followLogs("myagent", () => {});
      expect(typeof handle.stop).toBe("function");
      handle.stop();
    });
  });
});
