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

// Mock nginx config generator (dynamically imported by setupNginx)
vi.mock("../../src/cloud/vps/nginx.js", () => ({
  generateNginxConfig: () => "server { listen 443; }",
}));

// Mock fs for computePkgHash / unlinkSync
const mockReadFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
  };
});

import { buildSystemdUnit, pushToServer, computePkgHash } from "../../src/remote/push.js";

describe("buildSystemdUnit", () => {
  it("generates a valid systemd unit", () => {
    const unit = buildSystemdUnit("my-project", "/opt/action-llama");
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("Description=Action Llama scheduler (my-project)");
    expect(unit).toContain("WorkingDirectory=/opt/action-llama/project");
    expect(unit).toContain("node_modules/.bin/al start --headless -w -e\n");
    expect(unit).toContain("Requires=docker.service");
  });

  it("uses custom basePath", () => {
    const unit = buildSystemdUnit("proj", "/srv/al");
    expect(unit).toContain("WorkingDirectory=/srv/al/project");
  });

  it("uses project-local al binary and adds node to PATH", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", {
      nodePath: "/usr/local/bin/node", nodeVersion: "v22.22.1", dockerVersion: "29.3.0",
    });
    expect(unit).toContain("ExecStart=/opt/al/project/node_modules/.bin/al start --headless -w -e\n");
    expect(unit).toContain("Environment=PATH=/usr/local/bin:");
  });

  it("includes nvm node dir in PATH", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", {
      nodePath: "/home/user/.nvm/versions/node/v22/bin/node", nodeVersion: "v22.22.1", dockerVersion: "29.3.0",
    });
    expect(unit).toContain("ExecStart=/opt/al/project/node_modules/.bin/al start --headless -w -e\n");
    expect(unit).toContain("/home/user/.nvm/versions/node/v22/bin");
  });

  it("uses project-local al path even without binPaths", () => {
    const unit = buildSystemdUnit("proj", "/opt/al");
    expect(unit).toContain("ExecStart=/opt/al/project/node_modules/.bin/al start --headless -w -e\n");
    expect(unit).not.toContain("Environment=PATH=");
  });

  it("includes --port flag when gatewayPort is provided", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", undefined, 3000);
    expect(unit).toContain("node_modules/.bin/al start --headless -w -e --port 3000");
  });

  it("omits --port flag when gatewayPort is not provided", () => {
    const unit = buildSystemdUnit("proj", "/opt/al");
    expect(unit).not.toContain("--port");
  });
});

describe("computePkgHash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a deterministic hash for the same file contents", () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("package.json")) return Buffer.from('{"name":"test"}');
      if (path.endsWith("package-lock.json")) return Buffer.from('{"lockfileVersion":3}');
      throw new Error("not found");
    });

    const hash1 = computePkgHash("/project");
    const hash2 = computePkgHash("/project");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hashes for different contents", () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("package.json")) return Buffer.from('{"name":"a"}');
      if (path.endsWith("package-lock.json")) return Buffer.from("{}");
      throw new Error("not found");
    });
    const hash1 = computePkgHash("/project");

    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("package.json")) return Buffer.from('{"name":"b"}');
      if (path.endsWith("package-lock.json")) return Buffer.from("{}");
      throw new Error("not found");
    });
    const hash2 = computePkgHash("/project");

    expect(hash1).not.toBe(hash2);
  });

  it("handles missing files gracefully", () => {
    mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(() => computePkgHash("/project")).not.toThrow();
  });
});

describe("pushToServer", () => {
  const sshOpts = { host: "h", user: "root", port: 22 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshOptionsFromConfig.mockReturnValue({ ...sshOpts });
    mockSshExec.mockResolvedValue("");
    mockRsyncTo.mockResolvedValue(undefined);
    mockBootstrapServer.mockResolvedValue({ nodePath: "/usr/local/bin/node", nodeVersion: "v22.22.1", dockerVersion: "29.3.0" });
    mockUnlinkSync.mockReturnValue(undefined);
    // Mock sshSpawn to return a fake journal-tailing process
    mockSshSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      kill: vi.fn(),
    });
    // Mock readFileSync for computePkgHash
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("package.json")) return Buffer.from('{"name":"test"}');
      if (path.endsWith("package-lock.json")) return Buffer.from('{"lockfileVersion":3}');
      throw new Error("ENOENT");
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

    expect(mockBootstrapServer).toHaveBeenCalled();
    expect(mockRsyncTo).toHaveBeenCalledTimes(2); // project + credentials in parallel
    expect(mockSshExec).toHaveBeenCalled();
    // Verify npm install runs on the remote
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

  it("skips npm install when package hash matches remote", async () => {
    // First call returns remote hash matching local hash
    const localHash = computePkgHash("/tmp/project");
    mockSshExec.mockImplementation((_ssh: any, cmd: string) => {
      if (cmd.includes(".pkg-hash")) return Promise.resolve(localHash);
      return Promise.resolve("ok");
    });

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

    const sshCommands = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    expect(sshCommands.some((cmd: string) => cmd.includes("npm install"))).toBe(false);
    expect(logs.some((l) => l.includes("Dependencies unchanged"))).toBe(true);
  });

  it("forces npm install with forceInstall flag", async () => {
    // Even if hashes match, forceInstall should run npm install
    const localHash = computePkgHash("/tmp/project");
    mockSshExec.mockImplementation((_ssh: any, cmd: string) => {
      if (cmd.includes(".pkg-hash")) return Promise.resolve(localHash);
      return Promise.resolve("ok");
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await pushToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        envName: "my-server",
        forceInstall: true,
      });
    } finally {
      console.log = origLog;
    }

    const sshCommands = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    expect(sshCommands.some((cmd: string) => cmd.includes("npm install"))).toBe(true);
  });

  it("batches systemd setup into a single SSH call", async () => {
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

    const sshCommands = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    // systemd commands should be batched into a single &&-chained call
    const systemdBatch = sshCommands.find(
      (cmd: string) => cmd.includes("daemon-reload") && cmd.includes("enable action-llama"),
    );
    expect(systemdBatch).toBeDefined();
    expect(systemdBatch).toContain("&&");
  });

  it("batches .env.toml and symlink into a single SSH call", async () => {
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

    const sshCommands = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    const envBatch = sshCommands.find(
      (cmd: string) => cmd.includes(".env.toml") && cmd.includes("ln -sfn"),
    );
    expect(envBatch).toBeDefined();
    expect(envBatch).toContain("&&");
  });

  it("heredoc delimiters appear on their own line", async () => {
    mockSshExec.mockResolvedValue("ok");

    const origLog = console.log;
    console.log = () => {};
    try {
      await pushToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h", cloudflareHostname: "test.example.com" },
        globalConfig: {},
        envName: "my-server",
      });
    } finally {
      console.log = origLog;
    }

    const sshCommands = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    // Every heredoc delimiter (ENVEOF, UNITEOF, NGINXEOF) must be on its own
    // line — if " && " follows on the same line, the shell won't recognise
    // it as the end-of-heredoc marker and the command leaks into the file.
    for (const cmd of sshCommands) {
      for (const delim of ["ENVEOF", "UNITEOF", "NGINXEOF"]) {
        for (const line of cmd.split("\n")) {
          if (line === delim) continue; // correct: delimiter alone
          expect(line).not.toMatch(new RegExp(`^${delim}\\s*&&`));
        }
      }
    }
  });

  it("cleans up ControlMaster socket in finally block", async () => {
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

    expect(mockUnlinkSync).toHaveBeenCalled();
    const socketPath = mockUnlinkSync.mock.calls[0][0];
    expect(socketPath).toMatch(/^\/tmp\/al-ssh-/);
  });

  it("sets controlPath on SSH options", async () => {
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

    // The SSH options object passed to bootstrapServer should have controlPath
    const sshArg = mockBootstrapServer.mock.calls[0][0];
    expect(sshArg.controlPath).toMatch(/^\/tmp\/al-ssh-/);
  });
});
