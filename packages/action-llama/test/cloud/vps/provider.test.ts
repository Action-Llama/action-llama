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
    await expect(provider.reconcileAgents("/some/path")).resolves.toBeUndefined();
  });

  it("reconcileInfraPolicy is a no-op", async () => {
    await expect(provider.reconcileInfraPolicy()).resolves.toBeUndefined();
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

    await expect(provider.validateRoles("/some/path")).resolves.toBeUndefined();
    expect(mockExecFile).toHaveBeenCalled();
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
    const sshCmds = mockExecFile.mock.calls.map((c: any[]) => (c[1] as string[]).join(" "));
    expect(sshCmds.some((cmd: string) => cmd.includes("docker rm -f"))).toBe(true);
  });

  it("validateRoles throws when Docker is not available on VPS", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command === "echo ok") {
        cb(null, "ok\n", "");
      } else if (command.includes("docker info")) {
        // Docker check fails
        const err: any = new Error("docker info failed");
        err.code = 1;
        cb(err, "", "Cannot connect to the Docker daemon");
      } else {
        cb(null, "", "");
      }
    });

    await expect(provider.validateRoles("/some/path")).rejects.toThrow(
      `Docker not available on 1.2.3.4`
    );
  });

  it("deployScheduler throws when docker run fails", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command.includes("docker rm -f")) {
        cb(null, "", "");
      } else if (command.includes("docker run")) {
        // Simulate failure: exec callback with an error so exitCode != 0
        const err: any = new Error("port already in use");
        err.code = 125;
        cb(err, "", "port already in use");
      } else {
        cb(null, "", "");
      }
    });

    await expect(provider.deployScheduler("al-scheduler:sha123")).rejects.toThrow(
      "Failed to start scheduler"
    );
  });

  it("getSchedulerLogs returns log lines", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, "line 1\nline 2\nline 3\n", "");
    });

    const logs = await provider.getSchedulerLogs(10);
    expect(logs).toEqual(["line 1", "line 2", "line 3"]);
  });

  it("getSchedulerLogs returns empty array when container not found", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      const err: any = new Error("No such container");
      err.code = 1;
      cb(err, "", "No such container");
    });

    const logs = await provider.getSchedulerLogs(10);
    expect(logs).toEqual([]);
  });

  it("followSchedulerLogs streams stdout lines", () => {
    const { EventEmitter } = require("events");
    const mockProc = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProc);

    const receivedLines: string[] = [];
    provider.followSchedulerLogs((line) => receivedLines.push(line));

    // Simulate data arriving on stdout
    mockProc.stdout.emit("data", Buffer.from("hello world\n"));
    mockProc.stdout.emit("data", Buffer.from("second line\n"));

    expect(receivedLines).toContain("hello world");
    expect(receivedLines).toContain("second line");
  });

  it("followSchedulerLogs emits stderr lines via onStderr callback", () => {
    const { EventEmitter } = require("events");
    const mockProc = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProc);

    const stderrLines: string[] = [];
    provider.followSchedulerLogs(() => {}, (text) => stderrLines.push(text));

    mockProc.stderr.emit("data", Buffer.from("error occurred"));

    expect(stderrLines).toContain("error occurred");
  });

  it("followSchedulerLogs stop flushes remaining buffer and kills process", () => {
    const { EventEmitter } = require("events");
    const mockProc = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProc);

    const receivedLines: string[] = [];
    const handle = provider.followSchedulerLogs((line) => receivedLines.push(line));

    // Partial line (no trailing newline)
    mockProc.stdout.emit("data", Buffer.from("partial line without newline"));

    handle.stop();

    expect(receivedLines).toContain("partial line without newline");
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it("followSchedulerLogs stop does not flush empty buffer", () => {
    const { EventEmitter } = require("events");
    const mockProc = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProc);

    const receivedLines: string[] = [];
    const handle = provider.followSchedulerLogs((line) => receivedLines.push(line));

    // No data emitted
    handle.stop();

    // Nothing in the buffer, so onLine should not be called
    expect(receivedLines).toHaveLength(0);
    expect(mockProc.kill).toHaveBeenCalled();
  });
});
