import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

// --- Mocks ---

const mockDiscoverAgents = vi.fn();
const mockLoadAgentConfig = vi.fn();
const mockLoadGlobalConfig = vi.fn();
vi.mock("../../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  loadAgentConfig: (...args: any[]) => mockLoadAgentConfig(...args),
  loadGlobalConfig: (...args: any[]) => mockLoadGlobalConfig(...args),
}));

const mockResolveCredential = vi.fn();
vi.mock("../../../src/credentials/registry.js", () => ({
  resolveCredential: (...args: any[]) => mockResolveCredential(...args),
}));

const mockPromptCredential = vi.fn();
vi.mock("../../../src/credentials/prompter.js", () => ({
  promptCredential: (...args: any[]) => mockPromptCredential(...args),
}));

const mockCredentialExists = vi.fn();
const mockWriteCredentialFields = vi.fn();
vi.mock("../../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  credentialExists: (...args: any[]) => mockCredentialExists(...args),
  writeCredentialFields: (...args: any[]) => mockWriteCredentialFields(...args),
  loadCredentialField: () => undefined,
  loadCredentialFields: () => undefined,
  writeCredentialField: () => {},
}));

import { execute } from "../../../src/cli/commands/setup.js";

describe("setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadGlobalConfig.mockReturnValue({});
    mockCredentialExists.mockReturnValue(false);
  });

  it("prints message when no agents found", async () => {
    mockDiscoverAgents.mockReturnValue([]);
    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("No agents found");
    expect(mockPromptCredential).not.toHaveBeenCalled();
  });

  it("prints ok for all credentials already present", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token:default"] });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[ok] GitHub Token");
    expect(mockPromptCredential).not.toHaveBeenCalled();
  });

  it("prompts and writes missing credential", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token:default"] });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(false);
    mockPromptCredential.mockResolvedValue({ values: { token: "ghp_new" } });

    const output = await captureLog(() => execute({ project: "." }));
    expect(mockPromptCredential).toHaveBeenCalledOnce();
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("github_token", "default", { token: "ghp_new" });
    expect(output).toContain("1 configured");
  });

  it("writes multi-field credential", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["git_ssh:default"] });
    mockResolveCredential.mockReturnValue({
      id: "git_ssh",
      label: "Git SSH",
      fields: [{ name: "id_rsa" }, { name: "username" }, { name: "email" }],
    });
    mockCredentialExists.mockReturnValue(false);
    mockPromptCredential.mockResolvedValue({
      values: { id_rsa: "key-content", username: "Bot", email: "bot@example.com" },
    });

    await captureLog(() => execute({ project: "." }));
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("git_ssh", "default", {
      id_rsa: "key-content",
      username: "Bot",
      email: "bot@example.com",
    });
  });

  it("deduplicates credentials across agents", async () => {
    mockDiscoverAgents.mockReturnValue(["dev", "reviewer"]);
    mockLoadAgentConfig
      .mockReturnValueOnce({ name: "dev", credentials: ["github_token:default"] })
      .mockReturnValueOnce({ name: "reviewer", credentials: ["github_token:default"] });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    // Should only check once despite two agents needing it
    expect(mockResolveCredential).toHaveBeenCalledTimes(1);
    expect(output).toContain("1 credential(s)");
  });

  it("includes webhook secretCredentials from global config", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token:default"] });
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { secretCredentials: { github: "github_webhook_secret:default" } },
    });
    mockResolveCredential.mockImplementation((id: string) => ({
      id,
      label: id === "github_token" ? "GitHub Token" : "GitHub Webhook Secret",
      fields: [{ name: id === "github_token" ? "token" : "secret" }],
    }));
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("2 credential(s)");
    expect(mockResolveCredential).toHaveBeenCalledWith("github_token");
    expect(mockResolveCredential).toHaveBeenCalledWith("github_webhook_secret");
  });

  it("skips writing when promptCredential returns undefined", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["git_ssh:default"] });
    mockResolveCredential.mockReturnValue({
      id: "git_ssh",
      label: "SSH Key",
      fields: [{ name: "id_rsa" }, { name: "username" }, { name: "email" }],
    });
    mockCredentialExists.mockReturnValue(false);
    mockPromptCredential.mockResolvedValue(undefined);

    await captureLog(() => execute({ project: "." }));
    expect(mockWriteCredentialFields).not.toHaveBeenCalled();
  });
});
