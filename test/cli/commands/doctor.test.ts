import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

// --- Mocks ---

const mockDiscoverAgents = vi.fn();
const mockLoadAgentConfig = vi.fn();
const mockLoadGlobalConfig = vi.fn();
const mockValidateAgentConfig = vi.fn();
vi.mock("../../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  loadAgentConfig: (...args: any[]) => mockLoadAgentConfig(...args),
  loadGlobalConfig: (...args: any[]) => mockLoadGlobalConfig(...args),
  validateAgentConfig: (...args: any[]) => mockValidateAgentConfig(...args),
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
const mockListCredentialInstances = vi.fn();
vi.mock("../../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  credentialExists: (...args: any[]) => mockCredentialExists(...args),
  listCredentialInstances: (...args: any[]) => mockListCredentialInstances(...args),
  writeCredentialFields: (...args: any[]) => mockWriteCredentialFields(...args),
  loadCredentialField: () => undefined,
  loadCredentialFields: () => undefined,
  writeCredentialField: () => {},
  backendLoadField: () => Promise.resolve(undefined),
  backendLoadFields: () => Promise.resolve(undefined),
  backendCredentialExists: (...args: any[]) => Promise.resolve(mockCredentialExists(...args)),
  backendListInstances: (...args: any[]) => Promise.resolve(mockListCredentialInstances(...args)),
  backendRequireCredentialRef: () => Promise.resolve(),
  getDefaultBackend: () => {},
  setDefaultBackend: () => {},
  resetDefaultBackend: () => {},
}));

const mockConfirm = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  confirm: (...args: any[]) => mockConfirm(...args),
}));

const mockValidateTriggerFields = vi.fn();
const mockResolveWebhookSource = vi.fn();
vi.mock("../../../src/scheduler/webhook-setup.js", () => ({
  validateTriggerFields: (...args: any[]) => mockValidateTriggerFields(...args),
  resolveWebhookSource: (...args: any[]) => mockResolveWebhookSource(...args),
}));

import { execute } from "../../../src/cli/commands/doctor.js";

describe("doctor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadGlobalConfig.mockReturnValue({});
    mockCredentialExists.mockReturnValue(false);
    mockListCredentialInstances.mockReturnValue([]);
    mockConfirm.mockResolvedValue(false);
    mockValidateTriggerFields.mockReturnValue([]);
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

  it("discovers webhook secrets from agents with webhook triggers", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github", credential: "MyOrg" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token:default"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockResolveCredential.mockImplementation((id: string) => ({
      id,
      label: id === "github_token" ? "GitHub Token" : "GitHub Webhook Secret",
      fields: [{ name: id === "github_token" ? "token" : "secret" }],
    }));
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[ok] GitHub Token");
    expect(output).toContain("[ok] GitHub Webhook Secret (github_webhook_secret:MyOrg)");
    expect(mockResolveCredential).toHaveBeenCalledWith("github_webhook_secret");
  });

  it("skips webhook secret check when source has no credential", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github" } },  // no credential — unsigned
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token:default"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockResolveCredential.mockImplementation((id: string) => ({
      id,
      label: id === "github_token" ? "GitHub Token" : "GitHub Webhook Secret",
      fields: [{ name: id === "github_token" ? "token" : "secret" }],
    }));
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[ok] GitHub Token");
    // Should only have 1 credential check (github_token), not webhook secret
    expect(output).toContain("1 credential(s)");
  });

  it("headless mode checks local creds without prompting and throws on missing", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token:default"] });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(false);

    await expect(
      captureLog(() => execute({ project: ".", checkOnly: true }))
    ).rejects.toThrow("1 credential(s) missing");
    expect(mockPromptCredential).not.toHaveBeenCalled();
  });

  it("headless mode succeeds when local creds are present", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token:default"] });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
    expect(output).toContain("[ok] GitHub Token");
    expect(mockPromptCredential).not.toHaveBeenCalled();
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

  it("throws ConfigError when agent references undefined webhook source", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({ webhooks: {} });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: [],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });

    await expect(
      captureLog(() => execute({ project: "." }))
    ).rejects.toThrow('references webhook source "my-github"');
  });

  it("throws ConfigError on unrecognized webhook trigger field", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github", credential: "MyOrg" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: [],
      webhooks: [{ source: "my-github", repository: "foo" }],
    });
    mockValidateTriggerFields.mockReturnValue([
      'Agent "dev" webhook trigger: unrecognized field "repository" for github provider. Did you mean "repos"?',
    ]);

    await expect(
      captureLog(() => execute({ project: "." }))
    ).rejects.toThrow("Invalid webhook configuration");
  });

  it("passes with valid webhook trigger fields", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github", credential: "MyOrg" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token:default"],
      webhooks: [{ source: "my-github", events: ["issues"], org: "acme" }],
    });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(true);
    mockValidateTriggerFields.mockReturnValue([]);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[ok] GitHub Token");
  });

  it("validates agent scale does not exceed project scale", async () => {
    mockDiscoverAgents.mockReturnValue(["agent1", "agent2"]);
    mockLoadGlobalConfig.mockReturnValue({ scale: 3 });
    mockLoadAgentConfig.mockReturnValueOnce({ 
      name: "agent1", 
      scale: 2, 
      credentials: [],
      model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" }
    });
    mockLoadAgentConfig.mockReturnValueOnce({
      name: "agent2", 
      scale: 5, 
      credentials: [],
      model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" }
    });
    mockCollectCredentialRefs.mockReturnValue(new Set());

    await expect(execute({ project: "." })).rejects.toThrow("Agent scale violations:");
  });

  it("allows agent scale equal to project scale", async () => {
    mockDiscoverAgents.mockReturnValue(["agent1"]);
    mockLoadGlobalConfig.mockReturnValue({ scale: 3 });
    mockLoadAgentConfig.mockReturnValue({
      name: "agent1", 
      scale: 3, 
      credentials: [],
      model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" }
    });
    mockCollectCredentialRefs.mockReturnValue(new Set());
    mockEnsureGatewayApiKey.mockResolvedValue({ key: "test-key", generated: false });

    await expect(execute({ project: "." })).resolves.not.toThrow();
  });

  it("allows multiple agents within project scale", async () => {
    mockDiscoverAgents.mockReturnValue(["agent1", "agent2"]);
    mockLoadGlobalConfig.mockReturnValue({ scale: 5 });
    mockLoadAgentConfig.mockReturnValueOnce({
      name: "agent1", 
      scale: 2, 
      credentials: [],
      model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" }
    });
    mockLoadAgentConfig.mockReturnValueOnce({
      name: "agent2", 
      scale: 3, 
      credentials: [],
      model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" }
    });
    mockCollectCredentialRefs.mockReturnValue(new Set());
    mockEnsureGatewayApiKey.mockResolvedValue({ key: "test-key", generated: false });

    await expect(execute({ project: "." })).resolves.not.toThrow();
  });

  it("handles missing project scale", async () => {
    mockDiscoverAgents.mockReturnValue(["agent1"]);
    mockLoadGlobalConfig.mockReturnValue({}); // No scale defined
    mockLoadAgentConfig.mockReturnValue({
      name: "agent1", 
      scale: 10, 
      credentials: [],
      model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", authType: "api_key" }
    });
    mockCollectCredentialRefs.mockReturnValue(new Set());
    mockEnsureGatewayApiKey.mockResolvedValue({ key: "test-key", generated: false });

    await expect(execute({ project: "." })).resolves.not.toThrow();
  });
});
