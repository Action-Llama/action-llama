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

const mockLoadCredential = vi.fn();
const mockWriteCredential = vi.fn();
const mockWriteStructuredCredential = vi.fn();
vi.mock("../../../src/shared/credentials.js", () => ({
  loadCredential: (...args: any[]) => mockLoadCredential(...args),
  writeCredential: (...args: any[]) => mockWriteCredential(...args),
  writeStructuredCredential: (...args: any[]) => mockWriteStructuredCredential(...args),
}));

import { execute } from "../../../src/cli/commands/setup.js";

describe("setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadGlobalConfig.mockReturnValue({});
  });

  it("prints message when no agents found", async () => {
    mockDiscoverAgents.mockReturnValue([]);
    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("No agents found");
    expect(mockPromptCredential).not.toHaveBeenCalled();
  });

  it("prints ok for all credentials already present", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github-token"] });
    mockResolveCredential.mockReturnValue({
      id: "github-token",
      label: "GitHub Token",
      filename: "github-token",
      fields: [{ name: "token" }],
    });
    mockLoadCredential.mockReturnValue("ghp_existing");

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[ok] GitHub Token");
    expect(mockPromptCredential).not.toHaveBeenCalled();
  });

  it("prompts and writes missing single-field credential", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github-token"] });
    mockResolveCredential.mockReturnValue({
      id: "github-token",
      label: "GitHub Token",
      filename: "github-token",
      fields: [{ name: "token" }],
    });
    mockLoadCredential.mockReturnValue(undefined);
    mockPromptCredential.mockResolvedValue({ values: { token: "ghp_new" } });

    const output = await captureLog(() => execute({ project: "." }));
    expect(mockPromptCredential).toHaveBeenCalledOnce();
    expect(mockWriteCredential).toHaveBeenCalledWith("github-token", "ghp_new");
    expect(output).toContain("1 configured");
  });

  it("writes structured credential for multi-field definitions", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["multi-cred"] });
    mockResolveCredential.mockReturnValue({
      id: "multi-cred",
      label: "Multi Cred",
      filename: "multi-cred",
      fields: [{ name: "clientId" }, { name: "clientSecret" }],
    });
    mockLoadCredential.mockReturnValue(undefined);
    mockPromptCredential.mockResolvedValue({
      values: { clientId: "id123", clientSecret: "secret456" },
    });

    await captureLog(() => execute({ project: "." }));
    expect(mockWriteStructuredCredential).toHaveBeenCalledWith("multi-cred", {
      clientId: "id123",
      clientSecret: "secret456",
    });
  });

  it("deduplicates credentials across agents", async () => {
    mockDiscoverAgents.mockReturnValue(["dev", "reviewer"]);
    mockLoadAgentConfig
      .mockReturnValueOnce({ name: "dev", credentials: ["github-token"] })
      .mockReturnValueOnce({ name: "reviewer", credentials: ["github-token"] });
    mockResolveCredential.mockReturnValue({
      id: "github-token",
      label: "GitHub Token",
      filename: "github-token",
      fields: [{ name: "token" }],
    });
    mockLoadCredential.mockReturnValue("ghp_existing");

    const output = await captureLog(() => execute({ project: "." }));
    // Should only check once despite two agents needing it
    expect(mockResolveCredential).toHaveBeenCalledTimes(1);
    expect(output).toContain("1 credential(s)");
  });

  it("includes webhook secretCredentials from global config", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github-token"] });
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { secretCredentials: { github: "github-webhook-secret" } },
    });
    mockResolveCredential.mockImplementation((id: string) => ({
      id,
      label: id === "github-token" ? "GitHub Token" : "GitHub Webhook Secret",
      filename: id,
      fields: [{ name: id === "github-token" ? "token" : "secret" }],
    }));
    mockLoadCredential.mockReturnValue("existing");

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("2 credential(s)");
    expect(mockResolveCredential).toHaveBeenCalledWith("github-token");
    expect(mockResolveCredential).toHaveBeenCalledWith("github-webhook-secret");
  });

  it("skips writing when promptCredential returns undefined", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["id_rsa"] });
    mockResolveCredential.mockReturnValue({
      id: "id_rsa",
      label: "SSH Key",
      filename: "id_rsa",
      fields: [{ name: "key" }],
    });
    mockLoadCredential.mockReturnValue(undefined);
    mockPromptCredential.mockResolvedValue(undefined);

    await captureLog(() => execute({ project: "." }));
    expect(mockWriteCredential).not.toHaveBeenCalled();
    expect(mockWriteStructuredCredential).not.toHaveBeenCalled();
  });
});
