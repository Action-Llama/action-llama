import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock SSH module
const mockSshExec = vi.fn();
const mockRsyncTo = vi.fn();
const mockSshOptionsFromConfig = vi.fn();
vi.mock("../../src/remote/ssh.js", () => ({
  sshExec: (...args: any[]) => mockSshExec(...args),
  rsyncTo: (...args: any[]) => mockRsyncTo(...args),
  sshOptionsFromConfig: (...args: any[]) => mockSshOptionsFromConfig(...args),
}));

// Mock bootstrap
const mockBootstrapServer = vi.fn();
vi.mock("../../src/remote/bootstrap.js", () => ({
  bootstrapServer: (...args: any[]) => mockBootstrapServer(...args),
}));

import { buildSystemdUnit, pushToServer } from "../../src/remote/push.js";

describe("buildSystemdUnit", () => {
  it("generates a valid systemd unit", () => {
    const unit = buildSystemdUnit("my-project", "/opt/action-llama", 3000);
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("Description=Action Llama scheduler (my-project)");
    expect(unit).toContain("WorkingDirectory=/opt/action-llama/project");
    expect(unit).toContain("al start --headless --expose");
    expect(unit).toContain("AL_GATEWAY_PORT=3000");
    expect(unit).toContain("Requires=docker.service");
  });

  it("uses custom basePath and port", () => {
    const unit = buildSystemdUnit("proj", "/srv/al", 8080);
    expect(unit).toContain("WorkingDirectory=/srv/al/project");
    expect(unit).toContain("AL_GATEWAY_PORT=8080");
  });
});

describe("pushToServer", () => {
  const sshOpts = { host: "h", user: "root", port: 22 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshOptionsFromConfig.mockReturnValue(sshOpts);
    mockSshExec.mockResolvedValue("");
    mockRsyncTo.mockResolvedValue(undefined);
    mockBootstrapServer.mockResolvedValue(undefined);
  });

  it("runs full push flow", async () => {
    // Mock health check success
    mockSshExec.mockResolvedValue("ok");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await pushToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        envName: "my-server",
      });
    } finally {
      console.log = origLog;
    }

    expect(mockBootstrapServer).toHaveBeenCalledWith(sshOpts);
    expect(mockRsyncTo).toHaveBeenCalledTimes(2); // project + credentials
    expect(mockSshExec).toHaveBeenCalled();
    expect(logs.some((l) => l.includes("Deployed to h"))).toBe(true);
  });

  it("skips bootstrap and systemd in dry-run mode", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await pushToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        envName: "my-server",
        dryRun: true,
      });
    } finally {
      console.log = origLog;
    }

    expect(mockBootstrapServer).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("Dry run complete"))).toBe(true);
    // rsyncTo still called (with --dry-run flag)
    expect(mockRsyncTo).toHaveBeenCalled();
    for (const call of mockRsyncTo.mock.calls) {
      const extraFlags = call[4] || [];
      expect(extraFlags).toContain("--dry-run");
    }
  });

  it("skips credential sync with noCreds", async () => {
    mockSshExec.mockResolvedValue("ok");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await pushToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        envName: "my-server",
        noCreds: true,
      });
    } finally {
      console.log = origLog;
    }

    // Only 1 rsync call (project), not 2 (project + creds)
    expect(mockRsyncTo).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("Skipping credentials"))).toBe(true);
  });

  it("uses custom gatewayPort from serverConfig", async () => {
    mockSshExec.mockResolvedValue("ok");

    const origLog = console.log;
    console.log = () => {};
    try {
      await pushToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h", gatewayPort: 9090 },
        globalConfig: {},
        envName: "my-server",
      });
    } finally {
      console.log = origLog;
    }

    // Check that the systemd unit and health check use port 9090
    const sshCalls = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    expect(sshCalls.some((cmd: string) => cmd.includes("9090"))).toBe(true);
  });
});
