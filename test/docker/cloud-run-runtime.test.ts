import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudRunJobRuntime } from "../../src/docker/cloud-run-runtime.js";
import type { ContainerRuntime } from "../../src/docker/runtime.js";

// Mock credentials module
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
}));

// Mock fetch for GCP API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock child_process for gcloud and docker
vi.mock("child_process", () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === "gcloud") return "fake-access-token\n";
    if (cmd === "docker") return "sha256:abc123\n";
    return "";
  }),
}));

const defaultConfig = {
  gcpProject: "test-project",
  region: "us-central1",
  artifactRegistry: "us-central1-docker.pkg.dev/test-project/al-images",
  serviceAccount: "al-runner@test-project.iam.gserviceaccount.com",
};

describe("CloudRunJobRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("implements ContainerRuntime interface", () => {
    const runtime: ContainerRuntime = new CloudRunJobRuntime(defaultConfig);
    expect(typeof runtime.launch).toBe("function");
    expect(typeof runtime.streamLogs).toBe("function");
    expect(typeof runtime.waitForExit).toBe("function");
    expect(typeof runtime.kill).toBe("function");
    expect(typeof runtime.remove).toBe("function");
    expect(typeof runtime.prepareCredentials).toBe("function");
    expect(typeof runtime.pushImage).toBe("function");
    expect(typeof runtime.buildImage).toBe("function");
    expect(typeof runtime.cleanupCredentials).toBe("function");
    expect(runtime.needsGateway).toBe(false);
  });

  it("prepareCredentials maps credential refs to GSM secret mounts", async () => {
    const runtime = new CloudRunJobRuntime(defaultConfig);

    // Mock the GSM list API to return secrets for github_token:default
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        secrets: [
          { name: "projects/test-project/secrets/action-llama--github_token--default--token" },
        ],
      }),
    });

    const creds = await runtime.prepareCredentials(["github_token:default"]);
    expect(creds.strategy).toBe("secrets-manager");
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts).toHaveLength(1);
      expect(creds.mounts[0].secretId).toBe("action-llama--github_token--default--token");
      expect(creds.mounts[0].mountPath).toBe("/credentials/github_token/default/token");
    }
  });

  it("prepareCredentials uses custom secret prefix", async () => {
    const runtime = new CloudRunJobRuntime({ ...defaultConfig, secretPrefix: "myapp" });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        secrets: [
          { name: "projects/test-project/secrets/myapp--github_token--default--token" },
        ],
      }),
    });

    const creds = await runtime.prepareCredentials(["github_token:default"]);
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts[0].secretId).toBe("myapp--github_token--default--token");
    }
  });

  it("prepareCredentials handles multiple credential refs", async () => {
    const runtime = new CloudRunJobRuntime(defaultConfig);

    // First call: github_token fields
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        secrets: [
          { name: "projects/test-project/secrets/action-llama--github_token--default--token" },
        ],
      }),
    });
    // Second call: git_ssh fields
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        secrets: [
          { name: "projects/test-project/secrets/action-llama--git_ssh--default--id_rsa" },
          { name: "projects/test-project/secrets/action-llama--git_ssh--default--username" },
          { name: "projects/test-project/secrets/action-llama--git_ssh--default--email" },
        ],
      }),
    });

    const creds = await runtime.prepareCredentials(["github_token:default", "git_ssh:default"]);
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts).toHaveLength(4);
      expect(creds.mounts.map((m) => m.mountPath)).toEqual([
        "/credentials/github_token/default/token",
        "/credentials/git_ssh/default/id_rsa",
        "/credentials/git_ssh/default/username",
        "/credentials/git_ssh/default/email",
      ]);
    }
  });

  it("buildImage calls gcloud builds submit", async () => {
    const runtime = new CloudRunJobRuntime(defaultConfig);
    const { execFileSync } = await import("child_process");
    const mockExec = vi.mocked(execFileSync);
    mockExec.mockReturnValueOnce("" as any); // gcloud builds submit

    const result = await runtime.buildImage({
      tag: "al-agent:latest",
      dockerfile: "docker/Dockerfile",
      contextDir: "/tmp/context",
    });

    expect(result).toBe("us-central1-docker.pkg.dev/test-project/al-images/al-agent:latest");
    const buildCall = mockExec.mock.calls.find(
      (c) => c[0] === "gcloud" && (c[1] as string[])?.includes("builds")
    );
    expect(buildCall).toBeTruthy();
    expect((buildCall![1] as string[])).toContain("submit");
  });

  it("cleanupCredentials is a no-op", () => {
    const runtime = new CloudRunJobRuntime(defaultConfig);
    // Should not throw
    runtime.cleanupCredentials({ strategy: "secrets-manager", mounts: [] });
  });

  it("remove is a no-op", async () => {
    const runtime = new CloudRunJobRuntime(defaultConfig);
    // Should not throw
    await runtime.remove("projects/test-project/locations/us-central1/jobs/al-dev/executions/exec-abc");
  });

  it("kill calls cancel API", async () => {
    const runtime = new CloudRunJobRuntime(defaultConfig);
    const execName = "projects/test-project/locations/us-central1/jobs/al-dev/executions/exec-abc";

    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve("") });

    await runtime.kill(execName);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`${execName}:cancel`),
      expect.objectContaining({ method: "POST" })
    );
  });
});
