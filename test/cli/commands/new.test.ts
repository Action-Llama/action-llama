import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

const mockRunSetup = vi.fn();
vi.mock("../../../src/setup/prompts.js", () => ({
  runSetup: (...args: any[]) => mockRunSetup(...args),
}));

const mockWriteCredential = vi.fn();
const mockLoadCredential = vi.fn();
vi.mock("../../../src/shared/credentials.js", () => ({
  loadCredential: (...args: any[]) => mockLoadCredential(...args),
  requireCredential: () => "fake",
  writeCredential: (...args: any[]) => mockWriteCredential(...args),
}));

vi.mock("../../../src/setup/scaffold.js", () => ({
  scaffoldProject: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execute } from "../../../src/cli/commands/new.js";

const baseGlobalConfig = {};

describe("new", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCredential.mockReturnValue(undefined);
  });

  it("throws when no project name given", async () => {
    await expect(execute("")).rejects.toThrow();
  });

  it("writes new credentials", async () => {
    mockRunSetup.mockResolvedValue({
      globalConfig: baseGlobalConfig,
      secrets: {
        githubToken: "ghp_new",
        anthropicKey: "sk-ant-api-new",
        sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----\ndata\n-----END OPENSSH PRIVATE KEY-----\n",
      },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredential).toHaveBeenCalledWith("github-token", "ghp_new");
    expect(mockWriteCredential).toHaveBeenCalledWith("anthropic-key", "sk-ant-api-new");
    expect(mockWriteCredential).toHaveBeenCalledWith("id_rsa", expect.stringContaining("BEGIN OPENSSH"));
    expect(output).toContain("Setup complete!");
  });

  it("skips unchanged credentials", async () => {
    mockLoadCredential.mockImplementation((name: string) => {
      if (name === "github-token") return "ghp_existing";
      if (name === "anthropic-key") return "sk-ant-api-existing";
      if (name === "id_rsa") return "ssh-key";
      return undefined;
    });

    mockRunSetup.mockResolvedValue({
      globalConfig: baseGlobalConfig,
      secrets: {
        githubToken: "ghp_existing",
        anthropicKey: "sk-ant-api-existing",
        sshKey: "ssh-key",
      },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredential).not.toHaveBeenCalled();
    expect(output).toContain("GitHub token unchanged");
    expect(output).toContain("Anthropic key unchanged");
    expect(output).toContain("SSH key unchanged");
  });

  it("handles pi_auth (no anthropic key)", async () => {
    mockRunSetup.mockResolvedValue({
      globalConfig: baseGlobalConfig,
      secrets: {
        githubToken: "ghp_new",
        anthropicKey: undefined,
        sshKey: undefined,
      },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(output).toContain("Using existing pi auth");
  });
});
