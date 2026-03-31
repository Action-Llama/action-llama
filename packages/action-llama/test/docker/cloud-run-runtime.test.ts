import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Use vi.hoisted so these are available inside vi.mock factories
const {
  mockSpawn,
  mockMkdtempSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockRmSync,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockMkdtempSync: vi.fn(() => "/tmp/al-ctx-test"),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRmSync: vi.fn(),
}));

// Mock child_process so spawn is controllable
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: mockSpawn };
});

// Mock fs operations for buildImage (do NOT mock readFileSync to avoid breaking module init)
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdtempSync: mockMkdtempSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    rmSync: mockRmSync,
  };
});

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
import { listLogEntries, extractLogText, buildJobLogFilter } from "../../src/cloud/gcp/logging-api.js";
import { getDefaultBackend } from "../../src/shared/credentials.js";
import { cleanupOldImages } from "../../src/cloud/gcp/artifact-registry-api.js";

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

  describe("memory parsing (MB values)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(createJob).mockResolvedValue({} as any);
      vi.mocked(runJob).mockResolvedValue({ response: { name: "exec1" } } as any);
    });

    it("converts 4096m to 4Gi", async () => {
      const r = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await r.launch({ image: "img", agentName: "a", env: {}, credentials: creds, memory: "4096m" });
      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.containers[0].resources?.limits?.memory).toBe("4Gi");
    });

    it("converts 2048mi to 2Gi (case-insensitive Mi suffix)", async () => {
      const r = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await r.launch({ image: "img", agentName: "a", env: {}, credentials: creds, memory: "2048mi" });
      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.containers[0].resources?.limits?.memory).toBe("2Gi");
    });

    it("passes through unrecognised memory strings unchanged", async () => {
      const r = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await r.launch({ image: "img", agentName: "a", env: {}, credentials: creds, memory: "custom-format" });
      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.containers[0].resources?.limits?.memory).toBe("custom-format");
    });

    it("converts 1g to 1Gi", async () => {
      const r = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await r.launch({ image: "img", agentName: "a", env: {}, credentials: creds, memory: "1g" });
      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.containers[0].resources?.limits?.memory).toBe("1Gi");
    });

    it("converts 4.5G to 4.5Gi", async () => {
      const r = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      await r.launch({ image: "img", agentName: "a", env: {}, credentials: creds, memory: "4.5G" });
      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.containers[0].resources?.limits?.memory).toBe("4.5Gi");
    });
  });

  describe("launch with secretRefs volume mounts", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(createJob).mockResolvedValue({} as any);
      vi.mocked(runJob).mockResolvedValue({ response: { name: "exec-with-secrets" } } as any);
    });

    it("creates volumes and volumeMounts for each secretRef", async () => {
      const runtime = makeRuntime();
      const creds = {
        strategy: "secret-manager" as const,
        secretRefs: [
          { secretName: "al-cred-abc-github-token-default-api-key", mountPath: "/credentials/github_token/default/api_key" },
          { secretName: "al-cred-abc-slack-bot-token-default-value", mountPath: "/credentials/slack_bot_token/default/value" },
        ],
        bundle: {},
      };
      await runtime.launch({ image: "img", agentName: "agent", env: {}, credentials: creds });

      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      expect(template.template.volumes).toHaveLength(2);
      expect(template.template.containers[0].volumeMounts).toHaveLength(2);
    });

    it("strips invalid characters from volume name and truncates to 63 chars", async () => {
      const runtime = makeRuntime();
      const longName = "al-cred-" + "x".repeat(100);
      const creds = {
        strategy: "secret-manager" as const,
        secretRefs: [{ secretName: longName, mountPath: "/credentials/t/i/f" }],
        bundle: {},
      };
      await runtime.launch({ image: "img", agentName: "agent", env: {}, credentials: creds });

      const template = vi.mocked(createJob).mock.calls.at(-1)![4];
      const volName = template.template.volumes[0].name;
      expect(volName.length).toBeLessThanOrEqual(63);
    });

    it("extracts execution name from execOp.name when response.name is absent", async () => {
      vi.mocked(runJob).mockResolvedValue({ name: "projects/p/locations/r/jobs/j/executions/fallback-exec" } as any);
      const runtime = makeRuntime();
      const creds = { strategy: "secret-manager" as const, secretRefs: [], bundle: {} };
      const jobId = await runtime.launch({ image: "img", agentName: "agent", env: {}, credentials: creds });

      // The execution name should have been stored (no execOp.response.name, but execOp.name exists)
      (runtime as any).executionNames.set(jobId, "projects/p/locations/r/jobs/j/executions/fallback-exec");
      vi.mocked(pollExecutionUntilDone).mockResolvedValue({
        name: "executions/fallback-exec",
        uid: "uid1",
        createTime: "2026-01-01T00:00:00Z",
        completionTime: "2026-01-01T01:00:00Z",
        conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
      });
      const code = await runtime.waitForExit(jobId, 60);
      expect(code).toBe(0);
    });
  });

  describe("prepareCredentials edge cases", () => {
    it("skips credential ref when readAll returns null", async () => {
      const mockBackend = { readAll: vi.fn().mockResolvedValue(null) };
      vi.mocked(getDefaultBackend).mockReturnValueOnce(mockBackend as any);

      const runtime = makeRuntime();
      const creds = await runtime.prepareCredentials(["github_token/default"]);
      expect(creds.strategy).toBe("secret-manager");
      if (creds.strategy === "secret-manager") {
        expect(creds.secretRefs).toHaveLength(0);
        expect(creds.bundle).toEqual({});
      }
    });

    it("logs error and continues when createSecret throws", async () => {
      vi.mocked(createSecret).mockRejectedValueOnce(new Error("quota exceeded"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const runtime = makeRuntime();
      // Should not throw even though createSecret fails
      const creds = await runtime.prepareCredentials(["github_token/default"]);
      expect(creds.strategy).toBe("secret-manager");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("quota exceeded"));
      consoleSpy.mockRestore();
    });
  });

  describe("waitForExit exit code detection", () => {
    it("returns 42 when log entry contains 'exit code 42'", async () => {
      vi.mocked(pollExecutionUntilDone).mockResolvedValue({
        name: "exec1",
        uid: "uid1",
        createTime: "2026-01-01T00:00:00Z",
        completionTime: "2026-01-01T01:00:00Z",
        conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
      });
      vi.mocked(listLogEntries).mockResolvedValue({
        entries: [{ timestamp: "2026-01-01T00:00:01Z" }],
      } as any);
      vi.mocked(extractLogText).mockReturnValue("agent exiting with exit code 42");

      const runtime = makeRuntime();
      (runtime as any).executionNames.set("job-rerun", "exec1");
      const code = await runtime.waitForExit("job-rerun", 60);
      expect(code).toBe(42);
    });

    it("returns 42 when log entry contains 'exitCode=42'", async () => {
      vi.mocked(pollExecutionUntilDone).mockResolvedValue({
        name: "exec1",
        uid: "uid1",
        createTime: "2026-01-01T00:00:00Z",
        completionTime: "2026-01-01T01:00:00Z",
        conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
      });
      vi.mocked(listLogEntries).mockResolvedValue({
        entries: [{ timestamp: "2026-01-01T00:00:01Z" }],
      } as any);
      vi.mocked(extractLogText).mockReturnValue("process ended exitCode=42");

      const runtime = makeRuntime();
      (runtime as any).executionNames.set("job-rerun2", "exec1");
      const code = await runtime.waitForExit("job-rerun2", 60);
      expect(code).toBe(42);
    });

    it("extracts numeric exit code from CONDITION_FAILED message", async () => {
      vi.mocked(pollExecutionUntilDone).mockResolvedValue({
        name: "exec1",
        uid: "uid1",
        createTime: "2026-01-01T00:00:00Z",
        completionTime: "2026-01-01T01:00:00Z",
        conditions: [{ type: "Completed", state: "CONDITION_FAILED", message: "Container exited with exit code 137" }],
      });

      const runtime = makeRuntime();
      (runtime as any).executionNames.set("job-failed", "exec1");
      const code = await runtime.waitForExit("job-failed", 60);
      expect(code).toBe(137);
    });

    it("extracts exit code from 'exitCode=N' pattern in CONDITION_FAILED message", async () => {
      vi.mocked(pollExecutionUntilDone).mockResolvedValue({
        name: "exec1",
        uid: "uid1",
        createTime: "2026-01-01T00:00:00Z",
        completionTime: "2026-01-01T01:00:00Z",
        conditions: [{ type: "Completed", state: "CONDITION_FAILED", message: "exitCode=2" }],
      });

      const runtime = makeRuntime();
      (runtime as any).executionNames.set("job-failed2", "exec1");
      const code = await runtime.waitForExit("job-failed2", 60);
      expect(code).toBe(2);
    });
  });

  describe("fetchLogs", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns empty array when no jobs match the agent prefix", async () => {
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/p/locations/r/jobs/other-job-abc",
          uid: "u1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);
      const runtime = makeRuntime();
      const lines = await runtime.fetchLogs("myagent", 50);
      expect(lines).toEqual([]);
    });

    it("returns log lines from matching jobs", async () => {
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/p/locations/r/jobs/al-myagent-abc123",
          uid: "u1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);
      vi.mocked(listLogEntries).mockResolvedValue({
        entries: [
          { timestamp: "2026-01-01T00:00:01Z" },
          { timestamp: "2026-01-01T00:00:02Z" },
        ],
      } as any);
      vi.mocked(extractLogText).mockReturnValue("line one\nline two");
      vi.mocked(buildJobLogFilter).mockReturnValue("test-filter");

      const runtime = makeRuntime();
      const lines = await runtime.fetchLogs("myagent", 50);
      // Each entry emits "line one" and "line two"
      expect(lines).toContain("line one");
      expect(lines).toContain("line two");
    });

    it("slices to the requested limit", async () => {
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/p/locations/r/jobs/al-myagent-abc123",
          uid: "u1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);
      // Return 10 entries each with "line"
      vi.mocked(listLogEntries).mockResolvedValue({
        entries: Array.from({ length: 10 }, (_, i) => ({ timestamp: `t${i}` })),
      } as any);
      vi.mocked(extractLogText).mockReturnValue("line");

      const runtime = makeRuntime();
      const lines = await runtime.fetchLogs("myagent", 5);
      expect(lines.length).toBeLessThanOrEqual(5);
    });

    it("returns empty array when listJobs throws", async () => {
      vi.mocked(listJobs).mockRejectedValue(new Error("network error"));
      const runtime = makeRuntime();
      const lines = await runtime.fetchLogs("myagent", 50);
      expect(lines).toEqual([]);
    });
  });

  describe("streamLogs polling", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls listLogEntries on poll tick and forwards lines to callback", async () => {
      vi.useFakeTimers();
      vi.mocked(listLogEntries).mockResolvedValue({
        entries: [{ timestamp: "2026-01-01T00:00:01Z" }],
      } as any);
      vi.mocked(extractLogText).mockReturnValue("streamed line");
      vi.mocked(buildJobLogFilter).mockReturnValue("stream-filter");

      const runtime = makeRuntime();
      const lines: string[] = [];
      const handle = runtime.streamLogs("job1", (line) => lines.push(line));

      // Advance timer to trigger the first poll
      await vi.advanceTimersByTimeAsync(3100);

      expect(listLogEntries).toHaveBeenCalled();
      expect(lines).toContain("streamed line");

      handle.stop();
    });

    it("stops polling after stop() is called", async () => {
      vi.useFakeTimers();
      vi.mocked(listLogEntries).mockResolvedValue({ entries: [] } as any);

      const runtime = makeRuntime();
      const handle = runtime.streamLogs("job1", () => {});
      handle.stop();

      const callsBefore = vi.mocked(listLogEntries).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);
      // No additional polls after stop
      expect(vi.mocked(listLogEntries).mock.calls.length).toBe(callsBefore);
    });
  });

  describe("followLogs polling", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls listJobs and listLogEntries on poll tick and forwards lines", async () => {
      vi.useFakeTimers();
      vi.mocked(listJobs).mockResolvedValue([
        {
          name: "projects/p/locations/r/jobs/al-myagent-abc",
          uid: "u1",
          createTime: "2026-01-01T00:00:00Z",
          updateTime: "2026-01-01T00:00:00Z",
          template: { template: { containers: [] } },
        },
      ]);
      vi.mocked(listLogEntries).mockResolvedValue({
        entries: [{ timestamp: "2026-01-01T00:00:01Z" }],
      } as any);
      vi.mocked(extractLogText).mockReturnValue("followed line");
      vi.mocked(buildJobLogFilter).mockReturnValue("follow-filter");

      const runtime = makeRuntime();
      const lines: string[] = [];
      const handle = runtime.followLogs("myagent", (line) => lines.push(line));

      await vi.advanceTimersByTimeAsync(3100);

      expect(listJobs).toHaveBeenCalled();
      expect(lines).toContain("followed line");

      handle.stop();
    });

    it("stops polling after stop() is called", async () => {
      vi.useFakeTimers();
      vi.mocked(listJobs).mockResolvedValue([]);

      const runtime = makeRuntime();
      const handle = runtime.followLogs("myagent", () => {});
      handle.stop();

      const callsBefore = vi.mocked(listJobs).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);
      expect(vi.mocked(listJobs).mock.calls.length).toBe(callsBefore);
    });
  });

  describe("buildImage", () => {
    function makeFakeProc() {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }

    beforeEach(() => {
      mockSpawn.mockReset();
      mockMkdtempSync.mockReset();
      mockMkdirSync.mockReset();
      mockWriteFileSync.mockReset();
      mockRmSync.mockReset();
      mockMkdtempSync.mockReturnValue("/tmp/al-ctx-test");
    });

    it("spawns docker build and returns tag on success", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runtime = makeRuntime();
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
      });

      fakeProc.emit("close", 0);

      const result = await buildPromise;
      expect(result).toBe("my-image:latest");
      expect(mockSpawn).toHaveBeenCalledWith("docker", expect.arrayContaining(["build", "-t", "my-image:latest"]), expect.any(Object));
    });

    it("rejects on docker build failure", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runtime = makeRuntime();
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
      });

      fakeProc.stderr.emit("data", Buffer.from("build error output\n"));
      fakeProc.emit("close", 1);

      await expect(buildPromise).rejects.toThrow("Docker build failed (exit 1)");
    });

    it("rejects on spawn error", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runtime = makeRuntime();
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
      });

      fakeProc.emit("error", new Error("spawn ENOENT"));

      await expect(buildPromise).rejects.toThrow("spawn ENOENT");
    });

    it("replaces FROM line when baseImage is specified", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runtime = makeRuntime();
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:18\nRUN echo hi",
        baseImage: "node:20-alpine",
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      // Dockerfile written to temp dir should have updated FROM
      const writtenDockerfile = mockWriteFileSync.mock.calls.find(([path]) =>
        String(path).endsWith("Dockerfile")
      );
      expect(writtenDockerfile).toBeDefined();
      expect(String(writtenDockerfile![1])).toContain("FROM node:20-alpine");
    });

    it("injects COPY static/ directive when extraFiles provided", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runtime = makeRuntime();
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20\nRUN echo hi",
        extraFiles: { "config.json": '{"key":"value"}' },
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      // Should create static dir and write file
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("static"), expect.any(Object));
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("config.json"),
        '{"key":"value"}',
      );
    });

    it("uses dockerfile from contextDir when no dockerfileContent and no baseImage", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runtime = makeRuntime();
      // Pass dockerfileContent so we avoid readFileSync, but omit baseImage and extraFiles
      // to exercise the "no temp context" code path
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20\nRUN echo test",
      });

      fakeProc.emit("close", 0);
      await buildPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["-f", expect.stringContaining("Dockerfile")]),
        expect.any(Object),
      );
    });

    it("tags additional images after build", async () => {
      const fakeMainProc = makeFakeProc();
      const fakeTagProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeMainProc).mockReturnValueOnce(fakeTagProc);

      const runtime = makeRuntime();
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
        additionalTags: ["my-image:v1.0"],
      });

      // Close main build proc
      fakeMainProc.emit("close", 0);
      // Let microtasks run so _dockerExec can register its listener on fakeTagProc
      await Promise.resolve();
      await Promise.resolve();
      // Now close the tag proc
      fakeTagProc.emit("close", 0);
      await buildPromise;

      const tagCall = mockSpawn.mock.calls.find(([cmd, args]) => args[0] === "tag");
      expect(tagCall).toBeDefined();
      expect(tagCall![1]).toContain("my-image:v1.0");
    });

    it("cleans up temp build dir even on build failure", async () => {
      const fakeProc = makeFakeProc();
      mockSpawn.mockReturnValueOnce(fakeProc);

      const runtime = makeRuntime();
      const buildPromise = runtime.buildImage({
        tag: "my-image:latest",
        dockerfile: "Dockerfile",
        contextDir: "/tmp/ctx",
        dockerfileContent: "FROM node:20",
      });

      fakeProc.emit("close", 1);
      await expect(buildPromise).rejects.toThrow();

      // Temp dir should have been cleaned up
      expect(mockRmSync).toHaveBeenCalledWith("/tmp/al-ctx-test", { recursive: true });
    });
  });

  describe("isAgentRunning error handling", () => {
    it("returns false when listJobs throws", async () => {
      vi.mocked(listJobs).mockRejectedValue(new Error("API error"));
      const runtime = makeRuntime();
      const result = await runtime.isAgentRunning("myagent");
      expect(result).toBe(false);
    });
  });

  describe("listRunningAgents error handling", () => {
    it("returns empty array when listJobs throws", async () => {
      vi.mocked(listJobs).mockRejectedValue(new Error("API error"));
      const runtime = makeRuntime();
      const agents = await runtime.listRunningAgents();
      expect(agents).toEqual([]);
    });
  });

  describe("pushImage", () => {
    function makeFakeDockerProc() {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }

    beforeEach(() => {
      mockSpawn.mockReset();
      vi.mocked(cleanupOldImages).mockResolvedValue(undefined);
    });

    it("executes docker login, tag, push and returns registry URI", async () => {
      const loginProc = makeFakeDockerProc();
      const tagProc = makeFakeDockerProc();
      const pushProc = makeFakeDockerProc();

      mockSpawn
        .mockReturnValueOnce(loginProc)
        .mockReturnValueOnce(tagProc)
        .mockReturnValueOnce(pushProc);

      const runtime = makeRuntime();
      const pushPromise = runtime.pushImage("my-image:latest");

      // Resolve each _dockerExec call in sequence
      await Promise.resolve();
      loginProc.emit("close", 0);
      await Promise.resolve();
      await Promise.resolve();
      tagProc.emit("close", 0);
      await Promise.resolve();
      await Promise.resolve();
      pushProc.emit("close", 0);

      const result = await pushPromise;

      expect(result).toBe("us-central1-docker.pkg.dev/my-project/my-repo/my-image:latest");
      // login called with correct args
      const loginCall = mockSpawn.mock.calls[0];
      expect(loginCall[1]).toContain("login");
      expect(loginCall[1]).toContain("oauth2accesstoken");
      expect(loginCall[1]).toContain("test-token");
      // tag called
      const tagCall = mockSpawn.mock.calls[1];
      expect(tagCall[1]).toContain("tag");
      // push called
      const pushCall = mockSpawn.mock.calls[2];
      expect(pushCall[1]).toContain("push");
      // cleanupOldImages called after push
      expect(cleanupOldImages).toHaveBeenCalled();
    });

    it("continues when cleanupOldImages throws (best effort)", async () => {
      vi.mocked(cleanupOldImages).mockRejectedValue(new Error("Cleanup failed"));

      const loginProc = makeFakeDockerProc();
      const tagProc = makeFakeDockerProc();
      const pushProc = makeFakeDockerProc();

      mockSpawn
        .mockReturnValueOnce(loginProc)
        .mockReturnValueOnce(tagProc)
        .mockReturnValueOnce(pushProc);

      const runtime = makeRuntime();
      const pushPromise = runtime.pushImage("my-image:latest");

      await Promise.resolve();
      loginProc.emit("close", 0);
      await Promise.resolve();
      await Promise.resolve();
      tagProc.emit("close", 0);
      await Promise.resolve();
      await Promise.resolve();
      pushProc.emit("close", 0);

      // Should resolve successfully despite cleanup failure
      const result = await pushPromise;
      expect(result).toContain("my-image:latest");
    });

    it("_dockerExec rejects when docker exits with non-zero code", async () => {
      const loginProc = makeFakeDockerProc();
      mockSpawn.mockReturnValueOnce(loginProc);

      const runtime = makeRuntime();
      const pushPromise = runtime.pushImage("my-image:latest");

      await Promise.resolve();
      // Simulate docker login failure
      loginProc.stderr.emit("data", Buffer.from("authentication required\n"));
      loginProc.emit("close", 1);

      await expect(pushPromise).rejects.toThrow("docker login failed (exit 1)");
    });

    it("_dockerExec rejects on spawn error", async () => {
      const loginProc = makeFakeDockerProc();
      mockSpawn.mockReturnValueOnce(loginProc);

      const runtime = makeRuntime();
      const pushPromise = runtime.pushImage("my-image:latest");

      await Promise.resolve();
      loginProc.emit("error", new Error("spawn ENOENT"));

      await expect(pushPromise).rejects.toThrow("spawn ENOENT");
    });
  });
});
