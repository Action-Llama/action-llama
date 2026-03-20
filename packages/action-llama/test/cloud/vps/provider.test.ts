import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process for SSH operations
const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mockExecFile, spawn: mockSpawn };
});

const { VpsProvider } = await import("../../../src/cloud/vps/provider.js");
type VpsConfig = import("../../../src/shared/config.js").VpsConfig;

const testConfig: VpsConfig = {
  provider: "vps",
  host: "1.2.3.4",
  sshUser: "root",
  sshPort: 22,
  sshKeyPath: "/home/test/.ssh/id_rsa",
};

describe("VpsProvider", () => {
  let provider: InstanceType<typeof VpsProvider>;

  beforeEach(() => {
    mockExecFile.mockReset();
    mockSpawn.mockReset();
    provider = new VpsProvider(testConfig);
  });

  it("has correct providerName", () => {
    expect(provider.providerName).toBe("vps");
  });

  it("createRuntime returns SshDockerRuntime", () => {
    const runtime = provider.createRuntime();
    expect(runtime).toBeDefined();
    expect(typeof runtime.launch).toBe("function");
    expect(typeof runtime.buildImage).toBe("function");
    expect(runtime.needsGateway).toBe(false);
  });

  it("createAgentRuntime returns same runtime type (no routing)", () => {
    const agentConfig = {
      name: "test-agent",
      credentials: [],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }],
      timeout: 300,
    };

    const runtime = provider.createAgentRuntime(agentConfig, {});
    expect(runtime).toBeDefined();
    expect(runtime.needsGateway).toBe(false);
  });

  it("createRuntimes returns empty overrides", () => {
    const agents = [
      { name: "short", credentials: [], models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }], timeout: 300 },
      { name: "long", credentials: [], models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" as const }], timeout: 1800 },
    ];

    const result = provider.createRuntimes(agents, {});
    expect(result.runtime).toBeDefined();
    expect(Object.keys(result.agentRuntimeOverrides)).toHaveLength(0);
  });

  it("createCredentialBackend returns SshFilesystemBackend", async () => {
    const backend = await provider.createCredentialBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.read).toBe("function");
    expect(typeof backend.write).toBe("function");
    expect(typeof backend.list).toBe("function");
  });

  it("reconcileAgents is a no-op", async () => {
    await provider.reconcileAgents("/some/path");
  });

  it("reconcileInfraPolicy is a no-op", async () => {
    await provider.reconcileInfraPolicy();
  });

  it("validateRoles checks SSH and Docker connectivity", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command === "echo ok") {
        cb(null, "ok\n", "");
      } else if (command === "docker info --format '{{.ServerVersion}}'") {
        cb(null, "24.0.7\n", "");
      } else {
        cb(null, "", "");
      }
    });

    await provider.validateRoles("/some/path");
  });

  it("validateRoles throws when SSH fails", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error("Connection refused"), "", "");
    });

    await expect(provider.validateRoles("/some/path")).rejects.toThrow("Cannot SSH to 1.2.3.4");
  });

  it("deployScheduler starts container via SSH", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, "", "");
    });

    const result = await provider.deployScheduler("al-scheduler:abc123");
    expect(result.serviceUrl).toBe("http://1.2.3.4:8080");
    expect(result.status).toBe("running");
  });

  it("getSchedulerStatus returns status from docker inspect", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, "running\n", "");
    });

    const status = await provider.getSchedulerStatus();
    expect(status).not.toBeNull();
    expect(status!.status).toBe("running");
    expect(status!.serviceUrl).toBe("http://1.2.3.4:8080");
  });

  it("getSchedulerStatus returns null when container not found", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      const err: any = new Error("No such container");
      err.code = 1;
      cb(err, "", "No such container");
    });

    const status = await provider.getSchedulerStatus();
    expect(status).toBeNull();
  });

  it("teardownScheduler removes container via SSH", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, "", "");
    });

    await provider.teardownScheduler();
  });
});
