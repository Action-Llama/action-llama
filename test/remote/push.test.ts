import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock SSH module
const mockSshExec = vi.fn();
const mockSshSpawn = vi.fn();
const mockRsyncTo = vi.fn();
const mockSshOptionsFromConfig = vi.fn();
vi.mock("../../src/remote/ssh.js", () => ({
  sshExec: (...args: any[]) => mockSshExec(...args),
  sshSpawn: (...args: any[]) => mockSshSpawn(...args),
  rsyncTo: (...args: any[]) => mockRsyncTo(...args),
  sshOptionsFromConfig: (...args: any[]) => mockSshOptionsFromConfig(...args),
  buildSshArgs: () => ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-p", "22", "root@h"],
}));

// Mock bootstrap
const mockBootstrapServer = vi.fn();
vi.mock("../../src/remote/bootstrap.js", () => ({
  bootstrapServer: (...args: any[]) => mockBootstrapServer(...args),
}));

import { buildSystemdUnit, pushToServer } from "../../src/remote/push.js";

describe("buildSystemdUnit", () => {
  it("generates a valid systemd unit", () => {
    const unit = buildSystemdUnit("my-project", "/opt/action-llama");
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("Description=Action Llama scheduler (my-project)");
    expect(unit).toContain("WorkingDirectory=/opt/action-llama/project");
    expect(unit).toContain("node_modules/.bin/al start --headless --expose -w");
    expect(unit).toContain("Requires=docker.service");
  });

  it("uses custom basePath", () => {
    const unit = buildSystemdUnit("proj", "/srv/al");
    expect(unit).toContain("WorkingDirectory=/srv/al/project");
  });

  it("uses project-local al binary and adds node to PATH", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", {
      nodePath: "/usr/local/bin/node",
    });
    expect(unit).toContain("ExecStart=/opt/al/project/node_modules/.bin/al start --headless --expose -w");
    expect(unit).toContain("Environment=PATH=/usr/local/bin:");
  });

  it("includes nvm node dir in PATH", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", {
      nodePath: "/home/user/.nvm/versions/node/v22/bin/node",
    });
    expect(unit).toContain("ExecStart=/opt/al/project/node_modules/.bin/al start --headless --expose -w");
    expect(unit).toContain("/home/user/.nvm/versions/node/v22/bin");
  });

  it("uses project-local al path even without binPaths", () => {
    const unit = buildSystemdUnit("proj", "/opt/al");
    expect(unit).toContain("ExecStart=/opt/al/project/node_modules/.bin/al start --headless --expose -w");
    expect(unit).not.toContain("Environment=PATH=");
  });
});

describe("pushToServer", () => {
  const sshOpts = { host: "h", user: "root", port: 22 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshOptionsFromConfig.mockReturnValue(sshOpts);
    mockSshExec.mockResolvedValue("");
    mockRsyncTo.mockResolvedValue(undefined);
    mockBootstrapServer.mockResolvedValue({ nodePath: "/usr/local/bin/node" });
    // Mock sshSpawn to return a fake journal-tailing process
    mockSshSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      kill: vi.fn(),
    });
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
    // Verify npm install runs on the remote after syncing project files
    const sshCommands = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    expect(sshCommands.some((cmd: string) => cmd.includes("npm install"))).toBe(true);
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
  });

  it("always uses default gateway port 3000", async () => {
    mockSshExec.mockResolvedValue("ok");

    const origLog = console.log;
    console.log = () => {};
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

    // Check that the systemd unit and health check use port 3000
    const sshCalls = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    expect(sshCalls.some((cmd: string) => cmd.includes("3000"))).toBe(true);
  });
});
