import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

// --- Mocks ---

const mockDiscoverAgents = vi.fn();
const mockLoadGlobalConfig = vi.fn();
vi.mock("../../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  loadAgentConfig: vi.fn().mockReturnValue({ name: "dev", credentials: [] }),
  loadGlobalConfig: (...args: any[]) => mockLoadGlobalConfig(...args),
}));

const mockResolveEnvironmentName = vi.fn();
const mockLoadEnvironmentConfig = vi.fn();
vi.mock("../../../src/shared/environment.js", () => ({
  resolveEnvironmentName: (...args: any[]) => mockResolveEnvironmentName(...args),
  loadEnvironmentConfig: (...args: any[]) => mockLoadEnvironmentConfig(...args),
}));

vi.mock("../../../src/shared/server.js", () => ({
  validateServerConfig: (raw: any) => raw,
}));

// Mock doctor — push now delegates full config validation to doctor
const mockDoctorExecute = vi.fn();
vi.mock("../../../src/cli/commands/doctor.js", () => ({
  execute: (...args: any[]) => mockDoctorExecute(...args),
}));

const mockPushToServer = vi.fn();
const mockPushAgentToServer = vi.fn();
vi.mock("../../../src/remote/push.js", () => ({
  pushToServer: (...args: any[]) => mockPushToServer(...args),
  pushAgentToServer: (...args: any[]) => mockPushAgentToServer(...args),
}));

import { execute } from "../../../src/cli/commands/push.js";

describe("push command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({});
    mockDoctorExecute.mockResolvedValue(undefined);
    mockPushToServer.mockResolvedValue(undefined);
    mockPushAgentToServer.mockResolvedValue(undefined);
  });

  it("throws when no environment is specified", async () => {
    mockResolveEnvironmentName.mockReturnValue(undefined);

    await expect(
      captureLog(() => execute({ project: "." }))
    ).rejects.toThrow("No environment specified");
  });

  it("throws when environment has no [server] section", async () => {
    mockResolveEnvironmentName.mockReturnValue("my-env");
    mockLoadEnvironmentConfig.mockReturnValue({ gateway: { port: 8080 } });

    await expect(
      captureLog(() => execute({ project: ".", env: "my-env" }))
    ).rejects.toThrow("no [server] section");
  });

  it("throws when no agents found", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });
    mockDiscoverAgents.mockReturnValue([]);

    await expect(
      captureLog(() => execute({ project: ".", env: "srv" }))
    ).rejects.toThrow("No agents found");
  });

  it("runs doctor interactively by default (checkOnly: false)", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv" }));

    expect(mockDoctorExecute).toHaveBeenCalledOnce();
    expect(mockDoctorExecute.mock.calls[0][0]).toMatchObject({
      env: "srv",
      checkOnly: false,
    });
  });

  it("runs doctor in check-only mode when --headless is passed", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv", headless: true }));

    expect(mockDoctorExecute).toHaveBeenCalledOnce();
    expect(mockDoctorExecute.mock.calls[0][0]).toMatchObject({
      env: "srv",
      checkOnly: true,
    });
  });

  it("runs doctor interactively when --headless is explicitly false", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv", headless: false }));

    expect(mockDoctorExecute).toHaveBeenCalledOnce();
    expect(mockDoctorExecute.mock.calls[0][0]).toMatchObject({
      env: "srv",
      checkOnly: false,
    });
  });

  it("throws when doctor fails (e.g. missing credentials)", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });
    mockDoctorExecute.mockRejectedValue(new Error("1 credential(s) missing: github_token"));

    await expect(
      captureLog(() => execute({ project: ".", env: "srv" }))
    ).rejects.toThrow("credential(s) missing");
    expect(mockPushToServer).not.toHaveBeenCalled();
  });

  it("delegates to pushToServer on valid config", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv" }));

    expect(mockPushToServer).toHaveBeenCalledOnce();
    expect(mockPushToServer.mock.calls[0][0]).toMatchObject({
      serverConfig: { host: "h" },
    });
  });

  it("passes dry-run option through", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv", dryRun: true }));

    expect(mockPushToServer.mock.calls[0][0].dryRun).toBe(true);
  });

  it("passes noCreds when --creds-only is false and --files-only is true", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv", filesOnly: true }));

    expect(mockPushToServer.mock.calls[0][0].noCreds).toBe(true);
    expect(mockPushToServer.mock.calls[0][0].noFiles).toBe(false);
  });

  it("passes noFiles when --creds-only is true", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv", credsOnly: true }));

    expect(mockPushToServer.mock.calls[0][0].noFiles).toBe(true);
    expect(mockPushToServer.mock.calls[0][0].noCreds).toBe(false);
  });

  it("syncs everything with --all flag", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });

    await captureLog(() => execute({ project: ".", env: "srv", all: true }));

    expect(mockPushToServer.mock.calls[0][0].noCreds).toBe(false);
    expect(mockPushToServer.mock.calls[0][0].noFiles).toBe(false);
  });

  // --- Single-agent push ---

  it("throws when named agent does not exist", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });
    mockDiscoverAgents.mockReturnValue(["dev"]);

    await expect(
      captureLog(() => execute({ project: ".", env: "srv", agent: "ghost" }))
    ).rejects.toThrow('Agent "ghost" not found');
  });

  it("delegates to pushAgentToServer for single-agent push", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });
    mockDiscoverAgents.mockReturnValue(["dev"]);

    await captureLog(() => execute({ project: ".", env: "srv", agent: "dev" }));

    expect(mockPushAgentToServer).toHaveBeenCalledOnce();
    expect(mockPushAgentToServer.mock.calls[0][0]).toMatchObject({
      agentName: "dev",
      serverConfig: { host: "h" },
    });
    // Full push should NOT be called
    expect(mockPushToServer).not.toHaveBeenCalled();
  });

  it("skips doctor for single-agent push", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });
    mockDiscoverAgents.mockReturnValue(["dev"]);

    await captureLog(() => execute({ project: ".", env: "srv", agent: "dev" }));

    expect(mockDoctorExecute).not.toHaveBeenCalled();
  });

  it("passes sync flags through for single-agent push", async () => {
    mockResolveEnvironmentName.mockReturnValue("srv");
    mockLoadEnvironmentConfig.mockReturnValue({ server: { host: "h" } });
    mockDiscoverAgents.mockReturnValue(["dev"]);

    await captureLog(() => execute({ project: ".", env: "srv", agent: "dev", filesOnly: true, dryRun: true }));

    expect(mockPushAgentToServer.mock.calls[0][0]).toMatchObject({
      agentName: "dev",
      noCreds: true,
      noFiles: false,
      dryRun: true,
    });
  });
});
