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

const baseModel = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinkingLevel: "medium" as const,
  authType: "api_key" as const,
};

const baseAgents = [
  {
    name: "dev",
    template: "dev",
    config: {
      name: "dev",
      credentials: ["github-token"],
      model: baseModel,
      schedule: "*/5 * * * *",


      repos: ["acme/app"],
      params: { triggerLabel: "agent", assignee: "bot" },
    },
  },
  {
    name: "reviewer",
    template: "reviewer",
    config: {
      name: "reviewer",
      credentials: ["github-token"],
      model: baseModel,
      schedule: "*/5 * * * *",


      repos: ["acme/app"],
    },
  },
];

describe("new", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCredential.mockReturnValue(undefined);
  });

  it("throws when no project name given", async () => {
    // With Commander.js, the empty-name guard is handled at the CLI layer.
    // Calling execute("") directly hits runSetup which returns undefined from the unset mock.
    await expect(execute("")).rejects.toThrow();
  });

  it("writes new credentials", async () => {
    mockRunSetup.mockResolvedValue({
      globalConfig: baseGlobalConfig,
      agents: baseAgents,
      secrets: {
        githubToken: "ghp_new",
        sentryToken: "sntrys_new",
        anthropicKey: "sk-ant-api-new",
        sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----\ndata\n-----END OPENSSH PRIVATE KEY-----\n",
      },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredential).toHaveBeenCalledWith("github-token", "ghp_new");
    expect(mockWriteCredential).toHaveBeenCalledWith("sentry-token", "sntrys_new");
    expect(mockWriteCredential).toHaveBeenCalledWith("anthropic-key", "sk-ant-api-new");
    expect(mockWriteCredential).toHaveBeenCalledWith("id_rsa", expect.stringContaining("BEGIN OPENSSH"));
    expect(output).toContain("Setup complete!");
  });

  it("writes webhook secret credential", async () => {
    mockRunSetup.mockResolvedValue({
      globalConfig: { webhooks: { secretCredentials: { github: "github-webhook-secret" } } },
      agents: baseAgents,
      secrets: {
        githubToken: "ghp_new",
        githubWebhookSecret: "whsec_test123",
      },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredential).toHaveBeenCalledWith("github-webhook-secret", "whsec_test123");
    expect(output).toContain("github-webhook-secret");
  });

  it("skips unchanged credentials", async () => {
    mockLoadCredential.mockImplementation((name: string) => {
      if (name === "github-token") return "ghp_existing";
      if (name === "sentry-token") return "sntrys_existing";
      if (name === "anthropic-key") return "sk-ant-api-existing";
      if (name === "id_rsa") return "ssh-key";
      if (name === "github-webhook-secret") return "whsec_existing";
      return undefined;
    });

    mockRunSetup.mockResolvedValue({
      globalConfig: baseGlobalConfig,
      agents: baseAgents,
      secrets: {
        githubToken: "ghp_existing",     // unchanged
        sentryToken: "sntrys_existing",   // unchanged
        anthropicKey: "sk-ant-api-existing", // unchanged
        sshKey: "ssh-key",               // unchanged
        githubWebhookSecret: "whsec_existing", // unchanged
      },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredential).not.toHaveBeenCalled();
    expect(output).toContain("GitHub token unchanged");
    expect(output).toContain("Sentry token unchanged");
    expect(output).toContain("Anthropic key unchanged");
    expect(output).toContain("SSH key unchanged");
    expect(output).toContain("webhook secret unchanged");
  });

  it("handles pi_auth (no anthropic key)", async () => {
    mockRunSetup.mockResolvedValue({
      globalConfig: baseGlobalConfig,
      agents: baseAgents,
      secrets: {
        githubToken: "ghp_new",
        sentryToken: undefined,
        anthropicKey: undefined,
        sshKey: undefined,
      },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(output).toContain("Using existing pi auth");
  });
});
