import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process execFile (used by sshExecSafe in push.ts)
// We use the custom promisify symbol so that push.ts's `promisify(execFileCb)` picks up our mock.
const { mockExecFileCb, mockExecFilePromisified } = vi.hoisted(() => {
  const mockPromisified = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
  const mockCallback = vi.fn();
  // Attach the custom promisify symbol so that promisify(mockCallback) uses mockPromisified
  Object.defineProperty(mockCallback, Symbol.for("nodejs.util.promisify.custom"), {
    value: mockPromisified,
    writable: true,
    configurable: true,
  });
  return { mockExecFileCb: mockCallback, mockExecFilePromisified: mockPromisified };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mockExecFileCb };
});

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
// Must include single quotes (e.g. Connection '') to exercise heredoc escaping
vi.mock("../../src/cloud/vps/nginx.js", () => ({
  generateNginxConfig: () => `server {
    listen 443 ssl;
    location /dashboard/api/status-stream {
        proxy_set_header Connection '';
        proxy_buffering off;
    }
}`,
}));

// Mock fs for computePkgHash / unlinkSync
const mockReadFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockExistsSync = vi.fn();
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

// Mock credential-refs module
const mockCollectCredentialRefs = vi.fn();
const mockCredentialRefsToRelativePaths = vi.fn();
vi.mock("../../src/shared/credential-refs.js", () => ({
  collectCredentialRefs: (...args: any[]) => mockCollectCredentialRefs(...args),
  credentialRefsToRelativePaths: (...args: any[]) => mockCredentialRefsToRelativePaths(...args),
  IMPLICIT_CREDENTIAL_REFS: new Set(["gateway_api_key"]),
}));

// Mock config module
const mockLoadGlobalConfig = vi.fn();
vi.mock("../../src/shared/config.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadGlobalConfig: (...args: any[]) => mockLoadGlobalConfig(...args),
  };
});

import { ConfigError } from "../../src/shared/errors.js";
import { buildSystemdUnit, pushToServer, pushAgentToServer, computePkgHash } from "../../src/remote/push.js";

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

  it("includes -e when expose is true", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", undefined, undefined, true);
    expect(unit).toContain("start --headless -w -e\n");
  });

  it("omits -e when expose is false", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", undefined, undefined, false);
    expect(unit).not.toContain(" -e");
    expect(unit).toContain("start --headless -w\n");
  });

  it("includes -e when expose is undefined (backward compat default)", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", undefined, undefined, undefined);
    expect(unit).toContain("start --headless -w -e\n");
  });

  it("omits -e but keeps --port when expose is false and gatewayPort is set", () => {
    const unit = buildSystemdUnit("proj", "/opt/al", undefined, 3000, false);
    expect(unit).not.toContain(" -e");
    expect(unit).toContain("start --headless -w --port 3000");
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
    // Default execFile mock: returns empty stdout (safe for sshExecSafe calls)
    mockExecFilePromisified.mockResolvedValue({ stdout: "", stderr: "" });
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
    // Mock credential functions to simulate having some credentials
    mockCollectCredentialRefs.mockReturnValue(new Set(["github_token", "gateway_api_key"]));
    mockCredentialRefsToRelativePaths.mockReturnValue(["github_token/default", "gateway_api_key/default"]);
    // Mock existsSync: true for credential files, false for .env.toml (loadEnvToml)
    mockExistsSync.mockImplementation((path: string) => !path.endsWith(".env.toml"));
    // Mock loadGlobalConfig
    mockLoadGlobalConfig.mockReturnValue({});
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
    expect(mockRsyncTo).toHaveBeenCalledTimes(4); // project + individual credentials + frontend
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

    // Only 2 rsync calls (project + frontend), not 3 (project + creds + frontend)
    expect(mockRsyncTo).toHaveBeenCalledTimes(2);
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

  it("preserves single quotes in nginx config through heredoc", async () => {
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
    const nginxCmd = sshCommands.find((cmd: string) => cmd.includes("NGINXEOF"));
    expect(nginxCmd).toBeDefined();
    // The Connection '' directive must appear verbatim — no shell escaping
    expect(nginxCmd).toContain("proxy_set_header Connection '';");
    // Must NOT contain escaped single quotes (the old bug)
    expect(nginxCmd).not.toContain("'\\''");
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

  it("fails when non-implicit credentials are missing locally", async () => {
    // github_token does not exist locally, gateway_api_key (implicit) is OK to be missing
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("github_token")) return false;
      return true;
    });

    const origLog = console.log;
    console.log = () => {};
    try {
      await expect(pushToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        envName: "my-server",
      })).rejects.toThrow("credential(s) missing locally");
    } finally {
      console.log = origLog;
    }

    // Must NOT have rsynced any credential directories (project/frontend rsyncs may fire in parallel)
    const credRsyncCalls = mockRsyncTo.mock.calls.filter(
      (c: any[]) => typeof c[2] === "string" && c[2].includes("credentials"),
    );
    expect(credRsyncCalls).toHaveLength(0);
  });

  it("allows implicit credentials (gateway_api_key) to be missing locally", async () => {
    // Only gateway_api_key in the credential set, and it doesn't exist locally
    mockCollectCredentialRefs.mockReturnValue(new Set([]));
    mockCredentialRefsToRelativePaths.mockReturnValue(["gateway_api_key/default"]);
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("gateway_api_key")) return false;
      if (typeof path === "string" && path.endsWith(".env.toml")) return false;
      return true;
    });
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

    // Should succeed — implicit credentials don't block push
    expect(mockBootstrapServer).toHaveBeenCalled();
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

describe("pushAgentToServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSshOptionsFromConfig.mockReturnValue({ host: "h", user: "root", port: 22 });
    mockSshExec.mockResolvedValue("");
    mockRsyncTo.mockResolvedValue(undefined);
    mockUnlinkSync.mockReturnValue(undefined);
    // Mock credential functions to simulate having some credentials
    mockCollectCredentialRefs.mockReturnValue(new Set(["github_token", "gateway_api_key"]));
    mockCredentialRefsToRelativePaths.mockReturnValue(["github_token/default", "gateway_api_key/default"]);
    // Mock existsSync to return true for credential files
    mockExistsSync.mockReturnValue(true);
    // Mock loadGlobalConfig
    mockLoadGlobalConfig.mockReturnValue({});
  });

  it("rsyncs only the agent directory", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
      });
    } finally {
      console.log = origLog;
    }

    // Should rsync agent directory + individual credentials (3 calls)
    expect(mockRsyncTo).toHaveBeenCalledTimes(3);
    // First call: agent files
    expect(mockRsyncTo.mock.calls[0][1]).toBe("/tmp/project/agents/my-agent");
    expect(mockRsyncTo.mock.calls[0][2]).toContain("agents/my-agent");
  });

  it("skips bootstrap and systemd (no restart)", async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
      });
    } finally {
      console.log = origLog;
    }

    // No bootstrap
    expect(mockBootstrapServer).not.toHaveBeenCalled();
    // No systemd restart
    const sshCommands = mockSshExec.mock.calls.map((c: any[]) => c[1]);
    expect(sshCommands.some((cmd: string) => cmd.includes("systemctl restart"))).toBe(false);
    expect(sshCommands.some((cmd: string) => cmd.includes("daemon-reload"))).toBe(false);
    expect(sshCommands.some((cmd: string) => cmd.includes("npm install"))).toBe(false);
  });

  it("skips credential sync with noCreds", async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
        noCreds: true,
      });
    } finally {
      console.log = origLog;
    }

    // Only 1 rsync call (agent files), not 2
    expect(mockRsyncTo).toHaveBeenCalledTimes(1);
    expect(mockRsyncTo.mock.calls[0][1]).toBe("/tmp/project/agents/my-agent");
  });

  it("skips file sync with noFiles", async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
        noFiles: true,
      });
    } finally {
      console.log = origLog;
    }

    // Only 2 rsync calls (individual credentials), not 3
    expect(mockRsyncTo).toHaveBeenCalledTimes(2);
    expect(mockRsyncTo.mock.calls[0][2]).toContain("credentials");
  });

  it("supports dry-run mode", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
        dryRun: true,
      });
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes("Dry run complete"))).toBe(true);
    for (const call of mockRsyncTo.mock.calls) {
      const extraFlags = call[4] || [];
      expect(extraFlags).toContain("--dry-run");
    }
  });

  it("creates remote agent directory before rsync", async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
      });
    } finally {
      console.log = origLog;
    }

    const mkdirCall = mockSshExec.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].includes("mkdir -p") && c[1].includes("agents/my-agent"),
    );
    expect(mkdirCall).toBeDefined();
  });

  it("cleans up ControlMaster socket", async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
      });
    } finally {
      console.log = origLog;
    }

    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockUnlinkSync.mock.calls[0][0]).toMatch(/^\/tmp\/al-ssh-/);
  });

  it("fails when non-implicit credentials are missing locally", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("github_token")) return false;
      return true;
    });

    const origLog = console.log;
    console.log = () => {};
    try {
      await expect(pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
      })).rejects.toThrow("credential(s) missing locally");
    } finally {
      console.log = origLog;
    }
  });

  it("prints hot-reload message on success", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await pushAgentToServer({
        projectPath: "/tmp/project",
        serverConfig: { host: "h" },
        globalConfig: {},
        agentName: "my-agent",
      });
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes("hot-reload"))).toBe(true);
  });
});

describe("pushToServer — additional coverage paths", () => {
  const sshOpts = { host: "h", user: "root", port: 22 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshOptionsFromConfig.mockReturnValue({ ...sshOpts });
    mockSshExec.mockResolvedValue("");
    mockRsyncTo.mockResolvedValue(undefined);
    mockBootstrapServer.mockResolvedValue({ nodePath: "/usr/local/bin/node", nodeVersion: "v22.22.1", dockerVersion: "29.3.0" });
    mockUnlinkSync.mockReturnValue(undefined);
    mockSshSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      kill: vi.fn(),
    });
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("package.json")) return Buffer.from('{"name":"test"}');
      if (path.endsWith("package-lock.json")) return Buffer.from('{"lockfileVersion":3}');
      throw new Error("ENOENT");
    });
    mockCollectCredentialRefs.mockReturnValue(new Set(["github_token"]));
    mockCredentialRefsToRelativePaths.mockReturnValue(["github_token/default"]);
    mockExistsSync.mockImplementation((path: string) => !path.endsWith(".env.toml"));
    mockLoadGlobalConfig.mockReturnValue({});
  });

  it("includes telemetry in remote .env.toml when globalConfig.telemetry is set", async () => {
    mockSshExec.mockResolvedValue("ok"); // health check succeeds
    const sshCalls: Array<[any, string]> = [];
    mockSshExec.mockImplementation((_ssh: any, cmd: string) => {
      sshCalls.push([_ssh, cmd]);
      return Promise.resolve("ok");
    });

    await pushToServer({
      projectPath: "/tmp/project",
      serverConfig: { host: "h" },
      globalConfig: { telemetry: { enabled: true, provider: "otel", endpoint: "http://otel:4317" } } as any,
      envName: "my-server",
    });

    // Verify the .env.toml write command included telemetry
    const tomlWrite = sshCalls.find(([, cmd]) => cmd.includes(".env.toml") && cmd.includes("cat >") || cmd.includes("[telemetry]"));
    // The telemetry section should appear in the heredoc being written
    const heredocCall = sshCalls.find(([, cmd]) => cmd.includes("telemetry") && cmd.includes("enabled"));
    expect(heredocCall).toBeDefined();
  });

  it("reads existing remote .env.toml and preserves agent overrides", async () => {
    const sshCalls: Array<[any, string]> = [];
    mockSshExec.mockImplementation((_ssh: any, cmd: string) => {
      sshCalls.push([_ssh, cmd]);
      // Return existing TOML when reading the remote .env.toml
      if (cmd.includes("cat") && cmd.includes(".env.toml")) {
        return Promise.resolve("[agents.reporter]\nmodel = \"claude-3-haiku\"");
      }
      return Promise.resolve("ok");
    });

    await pushToServer({
      projectPath: "/tmp/project",
      serverConfig: { host: "h" },
      globalConfig: {},
      envName: "my-server",
    });

    // The remote TOML was read (cat command was called)
    const catCall = sshCalls.find(([, cmd]) => cmd.includes("cat") && cmd.includes(".env.toml"));
    expect(catCall).toBeDefined();
  });

  it("skips credential sync early when credentialRefsToRelativePaths returns empty array", async () => {
    mockSshExec.mockResolvedValue("ok");
    mockCredentialRefsToRelativePaths.mockReturnValue([]);

    const rsyncCallCountBefore = mockRsyncTo.mock.calls.length;

    await pushToServer({
      projectPath: "/tmp/project",
      serverConfig: { host: "h" },
      globalConfig: {},
      envName: "my-server",
    });

    // rsync should NOT have been called for credentials (since paths is empty → early return)
    const credRsyncCalls = mockRsyncTo.mock.calls.filter(([, , destPath]: any) =>
      typeof destPath === "string" && destPath.includes("credentials")
    );
    expect(credRsyncCalls.length).toBe(0);
  });

  it("invokes journal stdout data callback when journal emits data", async () => {
    mockSshExec.mockResolvedValue("ok");

    const outputLines: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => outputLines.push(args.join(" "));

    // Make the journalctl process emit stdout data immediately
    mockSshSpawn.mockReturnValue({
      stdout: {
        on: vi.fn().mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
          if (event === "data") {
            // Emit some journal lines including an empty line (should be skipped)
            cb(Buffer.from("Starting action-llama service\n\n  \nBuild complete"));
          }
        }),
      },
      kill: vi.fn(),
    });

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

    // The non-empty journal lines should have been printed with "  " prefix
    expect(outputLines.some((l) => l.includes("Starting action-llama service"))).toBe(true);
    expect(outputLines.some((l) => l.includes("Build complete"))).toBe(true);
  });

  it("resolveFrontendDist returns null when bundled frontend index.html is absent", async () => {
    // Override existsSync to return false for index.html paths → resolveFrontendDist returns null
    mockExistsSync.mockImplementation((path: string) => {
      if (String(path).endsWith("index.html")) return false;
      if (String(path).endsWith(".env.toml")) return false;
      return true; // credential files exist
    });

    mockSshExec.mockResolvedValue("ok"); // health check succeeds

    // Should complete without error (frontendDist = null → no frontend rsync)
    await pushToServer({
      projectPath: "/tmp/project",
      serverConfig: { host: "h" },
      globalConfig: {},
      envName: "my-server",
    });

    // Verify no frontend rsync was attempted
    const frontendRsync = mockRsyncTo.mock.calls.find(([, , dest]: any) =>
      typeof dest === "string" && dest.includes("frontend")
    );
    expect(frontendRsync).toBeUndefined();
  });

  it("resolveFrontendDist returns dist path when workspace frontend package index.html exists", async () => {
    // Make existsSync return false for the bundled path (../frontend/index.html)
    // but true for the workspace-linked distDir/index.html
    mockExistsSync.mockImplementation((path: string) => {
      const p = String(path);
      // The bundled dir is resolve(dirname(import.meta.url), "..", "frontend")
      // so the bundled index.html path contains ".../src/frontend/index.html"
      if (p.endsWith("index.html") && p.includes("/src/frontend")) return false;
      if (p.endsWith(".env.toml")) return false;
      // workspace-linked frontend dist/index.html → return true
      return true;
    });

    mockSshExec.mockResolvedValue("ok"); // health check succeeds

    // Should complete — resolveFrontendDist should return the workspace dist path
    await pushToServer({
      projectPath: "/tmp/project",
      serverConfig: { host: "h" },
      globalConfig: {},
      envName: "my-server",
    });

    // Should have attempted an rsync with a source ending in "dist"
    const frontendRsync = mockRsyncTo.mock.calls.find(([, src]: any) =>
      typeof src === "string" && src.includes("dist")
    );
    expect(frontendRsync).toBeDefined();
  });
});

describe("pushToServer — healthCheck failure paths", () => {
  const sshOpts = { host: "h", user: "root", port: 22 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshOptionsFromConfig.mockReturnValue({ ...sshOpts });
    mockRsyncTo.mockResolvedValue(undefined);
    mockBootstrapServer.mockResolvedValue({ nodePath: "/usr/local/bin/node", nodeVersion: "v22.22.1", dockerVersion: "29.3.0" });
    mockUnlinkSync.mockReturnValue(undefined);
    mockSshSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      kill: vi.fn(),
    });
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("package.json")) return Buffer.from('{"name":"test"}');
      if (path.endsWith("package-lock.json")) return Buffer.from('{"lockfileVersion":3}');
      throw new Error("ENOENT");
    });
    mockCollectCredentialRefs.mockReturnValue(new Set(["github_token"]));
    mockCredentialRefsToRelativePaths.mockReturnValue(["github_token/default"]);
    mockExistsSync.mockImplementation((path: string) => !String(path).endsWith(".env.toml"));
    mockLoadGlobalConfig.mockReturnValue({});
    // Default: sshExecSafe returns empty string (all exec calls succeed)
    mockExecFilePromisified.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("logs service-failed diagnostics when service reports failed status", async () => {
    // All SSH commands succeed except the health check curl
    mockSshExec.mockImplementation(async (_ssh: any, cmd: string) => {
      if (cmd.includes("curl -sf")) throw new Error("curl: (7) connection refused");
      return "";
    });

    // sshExecSafe uses execFile (promisified) — return "failed" for systemctl is-active
    mockExecFilePromisified.mockImplementation(async (_cmd: string, args: string[]) => {
      const command = Array.isArray(args) ? args[args.length - 1] : "";
      if (command.includes("systemctl is-active")) {
        return { stdout: "failed\n", stderr: "" };
      }
      if (command.includes("systemctl status")) {
        return { stdout: "● action-llama.service - FAILED\n   Active: failed", stderr: "" };
      }
      if (command.includes("journalctl")) {
        return { stdout: "Error: something went wrong\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
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

    expect(logs.some((l) => l.includes("Service failed to start"))).toBe(true);
    expect(logs.some((l) => l.includes("Service status"))).toBe(true);
    expect(logs.some((l) => l.includes("Recent logs"))).toBe(true);
  });

  it("logs service-failed diagnostics when service reports inactive status", async () => {
    mockSshExec.mockImplementation(async (_ssh: any, cmd: string) => {
      if (cmd.includes("curl -sf")) throw new Error("curl: (7) connection refused");
      return "";
    });

    mockExecFilePromisified.mockImplementation(async (_cmd: string, args: string[]) => {
      const command = Array.isArray(args) ? args[args.length - 1] : "";
      if (command.includes("systemctl is-active")) {
        return { stdout: "inactive\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
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

    expect(logs.some((l) => l.includes("Service failed to start"))).toBe(true);
  });

  it("sshExecSafe returns combined stdout+stderr when execFile throws with output", async () => {
    // Force health check to fail and service to report failed
    // so sshExecSafe is called for systemctl status / journalctl diagnostics
    mockSshExec.mockImplementation(async (_ssh: any, cmd: string) => {
      if (cmd.includes("curl -sf")) throw new Error("connection refused");
      return "";
    });

    // First promisified call (systemctl is-active): returns "failed" to break out of loop
    // Subsequent calls (systemctl status, journalctl): throw with stdout+stderr attached
    let execCallCount = 0;
    mockExecFilePromisified.mockImplementation(async (_cmd: string, args: string[]) => {
      execCallCount++;
      const command = Array.isArray(args) ? args[args.length - 1] : "";
      if (command.includes("systemctl is-active")) {
        return { stdout: "failed\n", stderr: "" };
      }
      // Simulate execFile error with stdout/stderr output
      const err: any = new Error("exit 1");
      err.stdout = "status output from stdout";
      err.stderr = "additional stderr";
      throw err;
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

    // sshExecSafe catches the error and returns combined stdout+stderr
    expect(logs.some((l) => l.includes("status output from stdout") || l.includes("additional stderr"))).toBe(true);
  });
});
