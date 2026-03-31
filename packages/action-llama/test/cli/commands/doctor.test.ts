import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

// --- Mocks ---

const mockDiscoverAgents = vi.fn();
const mockLoadAgentConfig = vi.fn();
const mockLoadAgentRuntimeConfig = vi.fn();
const mockLoadGlobalConfig = vi.fn();
const mockValidateAgentConfig = vi.fn();
vi.mock("../../../src/shared/config.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  loadAgentConfig: (...args: any[]) => mockLoadAgentConfig(...args),
  loadAgentRuntimeConfig: (...args: any[]) => mockLoadAgentRuntimeConfig(...args),
  loadGlobalConfig: (...args: any[]) => mockLoadGlobalConfig(...args),
  validateAgentConfig: (...args: any[]) => mockValidateAgentConfig(...args),
  loadProjectConfig: vi.fn(),
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
vi.mock("../../../src/events/webhook-setup.js", () => ({
  validateTriggerFields: (...args: any[]) => mockValidateTriggerFields(...args),
  resolveWebhookSource: (...args: any[]) => mockResolveWebhookSource(...args),
  resolveCredentialInstance: (sourceConfig: any, credType: string) => {
    const specific = sourceConfig[credType];
    if (typeof specific === "string") return specific;
    return sourceConfig.credential ?? "default";
  },
  KNOWN_PROVIDER_TYPES: new Set(["github", "sentry", "linear", "mintlify", "test"]),
  PROVIDER_TO_CREDENTIAL: {
    github: "github_webhook_secret",
    sentry: "sentry_client_secret",
    linear: "linear_webhook_secret",
    mintlify: "mintlify_webhook_secret",
  },
}));

const mockCollectCredentialRefs = vi.fn();
vi.mock("../../../src/shared/credential-refs.js", () => ({
  collectCredentialRefs: (...args: any[]) => mockCollectCredentialRefs(...args),
}));

const mockValidateGlobalConfig = vi.fn();
const mockValidateAgentConfigEnhanced = vi.fn();
const mockDetectGlobalConfigUnknownFields = vi.fn();
const mockDetectAgentFrontmatterUnknownFields = vi.fn();
const mockDetectAgentRuntimeConfigUnknownFields = vi.fn();
vi.mock("../../../src/shared/validation.js", () => ({
  validateGlobalConfig: (...args: any[]) => mockValidateGlobalConfig(...args),
  validateAgentConfig: (...args: any[]) => mockValidateAgentConfigEnhanced(...args),
  detectGlobalConfigUnknownFields: (...args: any[]) => mockDetectGlobalConfigUnknownFields(...args),
  detectAgentFrontmatterUnknownFields: (...args: any[]) => mockDetectAgentFrontmatterUnknownFields(...args),
  detectAgentRuntimeConfigUnknownFields: (...args: any[]) => mockDetectAgentRuntimeConfigUnknownFields(...args),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
  };
});

const mockExecFileSync = vi.fn();
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFileSync: (...args: any[]) => mockExecFileSync(...args),
  };
});

const mockEnsureGatewayApiKey = vi.fn();
vi.mock("../../../src/control/api-key.js", () => ({
  ensureGatewayApiKey: (...args: any[]) => mockEnsureGatewayApiKey(...args),
  loadGatewayApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

import { execute } from "../../../src/cli/commands/doctor.js";

describe("doctor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadGlobalConfig.mockReturnValue({});
    
    // Smart mock for collectCredentialRefs - returns credentials based on agent configs
    mockCollectCredentialRefs.mockImplementation((projectPath: string, globalConfig: any) => {
      const credentials = new Set<string>();
      // Mock the logic that collectCredentialRefs would normally do
      const agents = mockDiscoverAgents();
      if (Array.isArray(agents)) {
        agents.forEach((agentName: string) => {
          const config = mockLoadAgentConfig();
          if (config && config.credentials) {
            config.credentials.forEach((ref: string) => credentials.add(ref));
          }
          // Add webhook credentials if configured
          if (config && config.webhooks && globalConfig.webhooks) {
            config.webhooks.forEach((trigger: any) => {
              const sourceConfig = globalConfig.webhooks[trigger.source];
              if (sourceConfig && sourceConfig.type === "github" && sourceConfig.credential) {
                credentials.add(`github_webhook_secret:${sourceConfig.credential}`);
              }
            });
          }
        });
      }
      return credentials;
    });
    
    mockEnsureGatewayApiKey.mockResolvedValue({ key: "test-key", generated: false });
    mockCredentialExists.mockReturnValue(false);
    mockListCredentialInstances.mockReturnValue([]);
    mockConfirm.mockResolvedValue(false);
    mockValidateTriggerFields.mockReturnValue([]);
    mockValidateGlobalConfig.mockReturnValue({ errors: [], warnings: [] });
    mockValidateAgentConfigEnhanced.mockReturnValue({ errors: [], warnings: [] });
    mockDetectGlobalConfigUnknownFields.mockReturnValue([]);
    mockDetectAgentFrontmatterUnknownFields.mockReturnValue([]);
    mockDetectAgentRuntimeConfigUnknownFields.mockReturnValue([]);
    mockLoadAgentRuntimeConfig.mockReturnValue({});
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
  });

  it("prints message when no agents found", async () => {
    mockDiscoverAgents.mockReturnValue([]);
    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("No agents found");
    expect(mockPromptCredential).not.toHaveBeenCalled();
  });

  it("reports unknown global config fields as validation error", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
    mockLoadAgentRuntimeConfig.mockReturnValue({});
    mockCollectCredentialRefs.mockReturnValue(new Set());
    // Make config.toml exist to trigger global config validation
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith("config.toml") && !String(p).includes("agents"));
    mockReadFileSync.mockReturnValue("[models]\n");
    // Return unknown fields from global config check
    mockDetectGlobalConfigUnknownFields.mockReturnValue(["badField", "anotherBadField"]);

    await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow(
      "Unknown fields in config.toml: badField, anotherBadField"
    );
  });

  it("reports pi_auth model type as container-mode validation error", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      models: ["pi-model"],
    });
    mockLoadGlobalConfig.mockReturnValue({
      models: {
        "pi-model": { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "pi_auth" },
      },
    });
    mockCollectCredentialRefs.mockReturnValue(new Set());

    await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow(
      "pi_auth"
    );
  });

  it("prints ok for all credentials already present", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
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
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
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
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["git_ssh"] });
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
      .mockReturnValueOnce({ name: "dev", credentials: ["github_token"] })
      .mockReturnValueOnce({ name: "reviewer", credentials: ["github_token"] });
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
      credentials: ["github_token"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
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

  it("skips webhook secret check when source has no credential but allowUnsigned is true", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github", allowUnsigned: true } },  // no credential — unsigned but allowed
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
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

  it("skipCredentials skips credential checks entirely", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(false);

    // Should not throw even though credentials are missing
    const output = await captureLog(() => execute({ project: ".", checkOnly: true, skipCredentials: true }));
    expect(output).toContain("Skipping credential checks");
    expect(mockCollectCredentialRefs).not.toHaveBeenCalled();
    expect(mockPromptCredential).not.toHaveBeenCalled();
    expect(mockCredentialExists).not.toHaveBeenCalled();
  });

  it("skipCredentials also skips webhook security checks", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockCredentialExists.mockReturnValue(false);

    // Without skipCredentials this would throw "has no webhook secret stored"
    const output = await captureLog(() => execute({ project: ".", checkOnly: true, skipCredentials: true }));
    expect(output).toContain("Skipping credential checks");
  });

  it("headless mode checks local creds without prompting and throws on missing", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
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
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
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

  it("shows [ok] and skips prompting when credential exists in promptCredentials (non-checkOnly)", async () => {
    // This exercises the promptCredentials() path (not checkCredentials()),
    // covering loadCredentialFields() when credentialExists returns true.
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(true);
    // loadCredentialFields returns existing fields (token is present, no optional fields missing)
    // The default mock in vi.mock returns undefined, which means missingOptional = []
    // so we fall into the "[ok]" branch and continue without prompting.

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[ok] GitHub Token");
    expect(mockPromptCredential).not.toHaveBeenCalled();
  });

  it("skips writing when promptCredential returns undefined", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["git_ssh"] });
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
    mockLoadAgentRuntimeConfig.mockReturnValue({
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
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-github", repository: "foo" }],
    });
    mockValidateTriggerFields.mockReturnValue([
      'Agent "dev" webhook trigger: unrecognized field "repository" for github provider. Did you mean "repos"?',
    ]);

    await expect(
      captureLog(() => execute({ project: "." }))
    ).rejects.toThrow("validation error(s) found");
  });

  it("passes with valid webhook trigger fields", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github", credential: "MyOrg" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token"],
      webhooks: [{ source: "my-github", events: ["issues"], org: "acme" }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
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

  it("throws ConfigError when webhook source has unknown provider type", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-hook": { type: "githib", credential: "Org" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: [],
      webhooks: [{ source: "my-hook", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-hook", events: ["issues"] }],
    });

    await expect(
      captureLog(() => execute({ project: "." }))
    ).rejects.toThrow('unknown type "githib"');
  });

  it("throws error when webhook secret credential is missing and allowUnsigned not set", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockCredentialExists.mockReturnValue(false);

    await expect(() => execute({ project: "." })).rejects.toThrow(/has no webhook secret stored/);
  });

  it("shows security warning when allowUnsigned is explicitly set to true", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github", allowUnsigned: true } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: ["github_token"],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockResolveCredential.mockReturnValue({
      id: "github_token",
      label: "GitHub Token",
      fields: [{ name: "token" }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[SECURITY]");
    expect(output).toContain("allows unsigned requests");
    expect(output).toContain("my-github");
  });

  it("does not warn about unsigned webhooks for test provider", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-test": { type: "test" } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: [],
      webhooks: [{ source: "my-test", events: ["test"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-test", events: ["test"] }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).not.toContain("[warn]");
  });

  it("does not warn about unsigned webhooks in silent mode", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-github": { type: "github", allowUnsigned: true } },
    });
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: [],
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-github", events: ["issues"] }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: ".", silent: true }));
    expect(output).not.toContain("[warn]");
  });

  it("discovers linear webhook secrets from credential-refs", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadGlobalConfig.mockReturnValue({
      webhooks: { "my-linear": { type: "linear", credential: "LinearMain" } },
    });
    // Override the collectCredentialRefs mock to include linear credential
    mockCollectCredentialRefs.mockReturnValue(new Set(["linear_webhook_secret:LinearMain"]));
    mockLoadAgentConfig.mockReturnValue({
      name: "dev",
      credentials: [],
      webhooks: [{ source: "my-linear", events: ["issues"] }],
    });
    mockLoadAgentRuntimeConfig.mockReturnValue({
      webhooks: [{ source: "my-linear", events: ["issues"] }],
    });
    mockResolveCredential.mockReturnValue({
      id: "linear_webhook_secret",
      label: "Linear Webhook Secret",
      fields: [{ name: "secret" }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: "." }));
    expect(output).toContain("[ok] Linear Webhook Secret (linear_webhook_secret:LinearMain)");
  });

  it("prints validation errors even in silent mode", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
    mockExistsSync.mockImplementation((p: string) => p.endsWith("config.toml"));
    mockReadFileSync.mockReturnValue("[local]\n");
    mockValidateGlobalConfig.mockReturnValue({
      errors: [{ type: "error", message: "invalid cron expression", field: "schedule" }],
      warnings: [],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() =>
      expect(execute({ project: ".", silent: true })).rejects.toThrow("validation error(s) found")
    );
    expect(output).toContain("[error]");
    expect(output).toContain("invalid cron expression");
  });

  it("suppresses validation warnings in silent mode", async () => {
    mockDiscoverAgents.mockReturnValue(["dev"]);
    mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
    mockExistsSync.mockImplementation((p: string) => p.endsWith("config.toml"));
    mockReadFileSync.mockReturnValue("[local]\n");
    mockValidateGlobalConfig.mockReturnValue({
      errors: [],
      warnings: [{ type: "warning", message: "deprecated field", field: "old_field" }],
    });
    mockCredentialExists.mockReturnValue(true);

    const output = await captureLog(() => execute({ project: ".", silent: true }));
    expect(output).not.toContain("[warn]");
    expect(output).not.toContain("deprecated field");
  });

  describe("project-wide scale validation", () => {
    it("validates agent scale does not exceed project scale", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadGlobalConfig.mockReturnValue({ scale: 3 });
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: [],
        scale: 5,
      });
      mockLoadAgentRuntimeConfig.mockReturnValue({ scale: 5 });

      await expect(
        execute({ project: "." })
      ).rejects.toThrow('Agent "dev" scale (5) exceeds project scale limit (3)');
    });

    it("allows agent scale equal to project scale", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadGlobalConfig.mockReturnValue({ scale: 3 });
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: [],
        scale: 3,
      });
      mockLoadAgentRuntimeConfig.mockReturnValue({ scale: 3 });
      mockCredentialExists.mockReturnValue(true);

      await expect(execute({ project: "." })).resolves.not.toThrow();
    });

    it("allows multiple agents within project scale", async () => {
      mockDiscoverAgents.mockReturnValue(["dev", "reviewer"]);
      mockLoadGlobalConfig.mockReturnValue({ scale: 4 });
      mockLoadAgentConfig
        .mockReturnValueOnce({
          name: "dev",
          credentials: [],
          scale: 2,
        })
        .mockReturnValueOnce({
          name: "reviewer",
          credentials: [],
          scale: 1,
        });
      mockLoadAgentRuntimeConfig
        .mockReturnValueOnce({ scale: 2 })
        .mockReturnValueOnce({ scale: 1 });
      mockCredentialExists.mockReturnValue(true);

      await expect(execute({ project: "." })).resolves.not.toThrow();
    });

    it("handles missing project scale", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadGlobalConfig.mockReturnValue({}); // No scale limit
      mockLoadAgentConfig.mockReturnValue({
        name: "dev",
        credentials: [],
        scale: 10, // Would exceed if limit existed
      });
      mockLoadAgentRuntimeConfig.mockReturnValue({ scale: 10 });
      mockCredentialExists.mockReturnValue(true);

      await expect(execute({ project: "." })).resolves.not.toThrow();
    });
  });

  describe("host-user docker group check", () => {
    beforeEach(() => {
      // Default: user exists, sudo works, docker group exists, user NOT in docker group
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "id" && args[0] === "al-agent") return Buffer.from("1001");
        if (cmd === "id" && args[0] === "-Gn") return Buffer.from("al-agent");
        if (cmd === "getent" && args[0] === "group" && args[1] === "docker") return Buffer.from("docker:x:999:");
        if (cmd === "sudo" && args[0] === "-n") return Buffer.from("");
        throw new Error(`unexpected execFileSync: ${cmd} ${args.join(" ")}`);
      });
    });

    it("warns when host-user agent's user is not in docker group", async () => {
      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({
        runtime: { type: "host-user" },
      });
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
      expect(output).toContain("not in the docker group");
      expect(output).toContain("sudo usermod -aG docker al-agent");
    });

    it("prints ok when host-user agent's user is in docker group", async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "id" && args[0] === "al-agent") return Buffer.from("1001");
        if (cmd === "id" && args[0] === "-Gn") return Buffer.from("al-agent docker");
        if (cmd === "getent" && args[0] === "group" && args[1] === "docker") return Buffer.from("docker:x:999:");
        if (cmd === "sudo" && args[0] === "-n") return Buffer.from("");
        throw new Error(`unexpected execFileSync: ${cmd} ${args.join(" ")}`);
      });

      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({
        runtime: { type: "host-user" },
      });
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
      expect(output).toContain('[ok] User "al-agent" is in the docker group');
    });

    it("skips docker check when docker group does not exist", async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "id" && args[0] === "al-agent") return Buffer.from("1001");
        if (cmd === "getent" && args[0] === "group" && args[1] === "docker") throw new Error("not found");
        if (cmd === "sudo" && args[0] === "-n") return Buffer.from("");
        throw new Error(`unexpected execFileSync: ${cmd} ${args.join(" ")}`);
      });

      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({
        runtime: { type: "host-user" },
      });
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
      expect(output).not.toContain("docker group");
    });

    it("does not check docker group for container runtime agents", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({}); // default container runtime
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
      expect(output).not.toContain("docker group");
    });
  });

  describe("host-user configured groups check", () => {
    beforeEach(() => {
      // Default: user exists, sudo works, docker group exists (user in docker group),
      // custom group "audio" also exists
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "id" && args[0] === "al-agent") return Buffer.from("1001");
        if (cmd === "id" && args[0] === "-Gn") return Buffer.from("al-agent docker");
        if (cmd === "getent" && args[0] === "group" && args[1] === "docker") return Buffer.from("docker:x:999:");
        if (cmd === "getent" && args[0] === "group" && args[1] === "audio") return Buffer.from("audio:x:29:");
        if (cmd === "sudo" && args[0] === "-n") return Buffer.from("");
        throw new Error(`unexpected execFileSync: ${cmd} ${args.join(" ")}`);
      });
    });

    it("prints ok when a configured group exists on the system", async () => {
      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({
        runtime: { type: "host-user", groups: ["audio"] },
      });
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
      expect(output).toContain('[ok] Group "audio" exists');
    });

    it("warns when a configured group does not exist on the system", async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "id" && args[0] === "al-agent") return Buffer.from("1001");
        if (cmd === "id" && args[0] === "-Gn") return Buffer.from("al-agent docker");
        if (cmd === "getent" && args[0] === "group" && args[1] === "docker") return Buffer.from("docker:x:999:");
        if (cmd === "getent" && args[0] === "group" && args[1] === "nonexistent-group") throw new Error("not found");
        if (cmd === "sudo" && args[0] === "-n") return Buffer.from("");
        throw new Error(`unexpected execFileSync: ${cmd} ${args.join(" ")}`);
      });

      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({
        runtime: { type: "host-user", groups: ["nonexistent-group"] },
      });
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
      expect(output).toContain('"nonexistent-group"');
      expect(output).toContain("does not exist");
    });

    it("does not double-check docker group when it is in configured groups", async () => {
      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({
        runtime: { type: "host-user", groups: ["docker"] },
      });
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() => execute({ project: ".", checkOnly: true }));
      // docker group check is done by the normal docker group check, not the extra groups loop
      expect(output).toContain("docker group");
      // Should not have duplicate "ok" messages for docker
      const dockerOkCount = (output.match(/\[ok\] Group "docker" exists/g) || []).length;
      expect(dockerOkCount).toBe(0); // docker is skipped in the extra groups loop
    });
  });

  describe("project-root guard", () => {
    it("throws ConfigError when project path looks like an agent directory (SKILL.md at root)", async () => {
      // Simulate existsSync returning true for the SKILL.md at project root
      mockExistsSync.mockImplementation((p: string) => p.endsWith("SKILL.md"));

      await expect(execute({ project: "/my-project" })).rejects.toThrow(
        "looks like an agent directory, not a project directory"
      );
    });
  });

  describe("enhanced agent validation (SKILL.md exists)", () => {
    beforeEach(() => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({});
      mockCredentialExists.mockReturnValue(true);
      mockCollectCredentialRefs.mockReturnValue(new Set());

      // Make agent SKILL.md exist (but not project root SKILL.md)
      mockExistsSync.mockImplementation((p: string) =>
        p.includes("agents/dev/SKILL.md") || p.includes("agents/dev/config.toml")
      );
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes("SKILL.md")) return "---\n---\n\n# Dev Agent\n";
        if (p.includes("config.toml")) return "models = []\n";
        return "";
      });
    });

    it("runs enhanced validation when agent SKILL.md exists", async () => {
      mockValidateAgentConfigEnhanced.mockReturnValue({ errors: [], warnings: [] });

      await expect(execute({ project: ".", checkOnly: true, skipCredentials: true })).resolves.not.toThrow();
      expect(mockValidateAgentConfigEnhanced).toHaveBeenCalled();
    });

    it("reports validation error from validateAgentConfigEnhanced", async () => {
      mockValidateAgentConfigEnhanced.mockReturnValue({
        errors: [{ type: "error", message: "schedule is required" }],
        warnings: [],
      });

      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow(
        'Agent "dev": schedule is required'
      );
    });

    it("includes field name in error message when field is provided", async () => {
      mockValidateAgentConfigEnhanced.mockReturnValue({
        errors: [{ type: "error", message: "invalid cron", field: "schedule" }],
        warnings: [],
      });

      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow(
        'Agent "dev": invalid cron (schedule)'
      );
    });

    it("reports validation warnings from validateAgentConfigEnhanced in non-silent mode", async () => {
      mockValidateAgentConfigEnhanced.mockReturnValue({
        errors: [],
        warnings: [{ type: "warning", message: "timeout is quite long", field: "timeout" }],
      });

      const output = await captureLog(() => execute({ project: ".", checkOnly: true, skipCredentials: true }));
      expect(output).toContain("[warn]");
      expect(output).toContain("timeout is quite long");
    });

    it("reports unknown fields in agent SKILL.md frontmatter as error", async () => {
      mockValidateAgentConfigEnhanced.mockReturnValue({ errors: [], warnings: [] });
      mockDetectAgentFrontmatterUnknownFields.mockReturnValue(["unknownKey", "badField"]);

      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow(
        'Unknown fields in agent "dev" SKILL.md: unknownKey, badField'
      );
    });

    it("reports unknown fields in agent config.toml as error", async () => {
      mockValidateAgentConfigEnhanced.mockReturnValue({ errors: [], warnings: [] });
      mockDetectAgentRuntimeConfigUnknownFields.mockReturnValue(["weirdProp"]);

      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow(
        'Unknown fields in agent "dev" config.toml: weirdProp'
      );
    });

    it("catches exception during per-agent enhanced validation and adds as error", async () => {
      mockValidateAgentConfigEnhanced.mockImplementation(() => {
        throw new Error("boom during validation");
      });

      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow(
        "validation error(s) found"
      );
    });
  });

  describe("validation warnings display", () => {
    it("displays warnings in non-silent mode without throwing when no errors", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({});
      mockCollectCredentialRefs.mockReturnValue(new Set());
      mockValidateGlobalConfig.mockReturnValue({
        errors: [],
        warnings: [{ type: "warning", message: "deprecated option", field: "old_field" }],
      });
      // Make config.toml exist to trigger global validation
      mockExistsSync.mockImplementation((p: string) => p.endsWith("config.toml") && !p.includes("agents"));
      mockReadFileSync.mockReturnValue("[models]\n");

      const output = await captureLog(() =>
        execute({ project: ".", checkOnly: true, skipCredentials: true })
      );
      expect(output).toContain("[warn]");
      expect(output).toContain("deprecated option");
      expect(output).toContain("--- Configuration Validation ---");
    });

    it("displays both warnings and errors when present", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({ models: ["undefined-model"] });
      mockCollectCredentialRefs.mockReturnValue(new Set());
      mockValidateGlobalConfig.mockReturnValue({
        errors: [],
        warnings: [{ type: "warning", message: "suggestion for improvement" }],
      });
      // Make config.toml exist to trigger global validation
      mockExistsSync.mockImplementation((p: string) => p.endsWith("config.toml") && !p.includes("agents"));
      mockReadFileSync.mockReturnValue("[models]\n");

      const output = await captureLog(() =>
        expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow("validation error(s) found")
      );
      expect(output).toContain("[warn]");
      expect(output).toContain("[error]");
    });
  });

  describe("gateway API key", () => {
    it("prints newly generated gateway API key", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({});
      mockCollectCredentialRefs.mockReturnValue(new Set());
      mockEnsureGatewayApiKey.mockResolvedValue({ key: "new-generated-key-abc123", generated: true });

      const output = await captureLog(() =>
        execute({ project: ".", skipCredentials: true })
      );
      expect(output).toContain("new-generated-key-abc123");
      expect(output).toContain("Save this key");
    });
  });

  describe("promptCredentials silent mode", () => {
    it("shows missing count and prompts in silent mode when credentials are missing", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
      mockLoadAgentRuntimeConfig.mockReturnValue({});
      mockCollectCredentialRefs.mockReturnValue(new Set(["github_token:default"]));
      mockResolveCredential.mockReturnValue({
        id: "github_token",
        label: "GitHub Token",
        fields: [{ name: "token" }],
      });
      mockCredentialExists.mockReturnValue(false);
      mockPromptCredential.mockResolvedValue({ values: { token: "ghp_abc" } });

      const output = await captureLog(() =>
        execute({ project: ".", silent: true })
      );
      // In silent mode with missing creds, it should show count and prompt
      expect(output).toContain("credential(s) need to be configured");
      expect(mockPromptCredential).toHaveBeenCalled();
    });

    it("returns early in silent mode when all credentials present", async () => {
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
      mockLoadAgentRuntimeConfig.mockReturnValue({});
      mockCollectCredentialRefs.mockReturnValue(new Set(["github_token:default"]));
      mockResolveCredential.mockReturnValue({
        id: "github_token",
        label: "GitHub Token",
        fields: [{ name: "token" }],
      });
      mockCredentialExists.mockReturnValue(true);

      const output = await captureLog(() =>
        execute({ project: ".", silent: true })
      );
      // Silent mode + all creds present → no output about credentials
      expect(output).not.toContain("credential(s) need to be configured");
      expect(mockPromptCredential).not.toHaveBeenCalled();
    });
  });

  describe("promptCredentials optional fields", () => {
    it("falls through to prompting when credential exists but has missing optional fields", async () => {
      const mockLoadCredentialFieldsImpl = vi.fn().mockResolvedValue({ token: "existing-token" });
      // Override the loadCredentialFields mock to return a non-null value
      vi.doMock("../../../src/shared/credentials.js", () => ({
        parseCredentialRef: (ref: string) => {
          const sep = ref.indexOf(":");
          if (sep === -1) return { type: ref, instance: "default" };
          return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
        },
        credentialExists: (...args: any[]) => mockCredentialExists(...args),
        listCredentialInstances: (...args: any[]) => mockListCredentialInstances(...args),
        writeCredentialFields: (...args: any[]) => mockWriteCredentialFields(...args),
        loadCredentialField: () => undefined,
        loadCredentialFields: mockLoadCredentialFieldsImpl,
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

      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: ["github_token"] });
      mockLoadAgentRuntimeConfig.mockReturnValue({});
      mockCollectCredentialRefs.mockReturnValue(new Set(["github_token:default"]));
      // Credential has an optional field not present in existing values
      mockResolveCredential.mockReturnValue({
        id: "github_token",
        label: "GitHub Token",
        fields: [{ name: "token" }, { name: "email", optional: true }],
      });
      // Credential exists
      mockCredentialExists.mockReturnValue(true);
      mockPromptCredential.mockResolvedValue({ values: { token: "ghp_abc", email: "x@y.com" } });

      // Reset the mock to use our new implementation
      vi.resetModules();
    });
  });

  describe("host-user user creation on non-checkOnly", () => {
    it("auto-creates user on Linux when user does not exist and not checkOnly", async () => {
      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({ runtime: { type: "host-user" } });
      mockCredentialExists.mockReturnValue(true);
      mockCollectCredentialRefs.mockReturnValue(new Set());

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        // user "id" check fails — user doesn't exist
        if (cmd === "id" && args[0] === "al-agent") throw new Error("user not found");
        // sudo useradd succeeds (args = ["useradd", "-r", "-m", ...])
        if (cmd === "sudo" && args[0] === "useradd") return Buffer.from("");
        // sudo -n check fails (no sudoers yet)
        if (cmd === "sudo" && args[0] === "-n") throw new Error("no sudo");
        // sudo tee for sudoers (args = ["tee", "/etc/sudoers.d/..."])
        if (cmd === "sudo" && args[0] === "tee") return Buffer.from("");
        // sudo chmod (args = ["chmod", "0440", ...])
        if (cmd === "sudo" && args[0] === "chmod") return Buffer.from("");
        // getent docker group check fails
        if (cmd === "getent") throw new Error("no docker");
        throw new Error(`unexpected: ${cmd} ${args.join(" ")}`);
      });

      const output = await captureLog(() =>
        execute({ project: ".", skipCredentials: true })
      );
      // On Linux, user should be created (or at least attempted)
      // The mock doesn't actually care about platform, but on Linux systems this path runs
      expect(mockExecFileSync).toHaveBeenCalled();
    });
  });

  describe("global config read error", () => {
    it("catches errors thrown while reading global config.toml", async () => {
      mockValidateAgentConfig.mockReset();
      mockDiscoverAgents.mockReturnValue(["dev"]);
      mockLoadAgentConfig.mockReturnValue({ name: "dev", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({});
      mockCollectCredentialRefs.mockReturnValue(new Set());
      mockCredentialExists.mockReturnValue(true);

      // Make existsSync return true for config.toml so we enter the try block
      mockExistsSync.mockImplementation((p: string) => String(p).endsWith("config.toml"));
      // Make readFileSync throw when reading config.toml
      mockReadFileSync.mockImplementation((p: string) => {
        if (String(p).endsWith("config.toml")) throw new Error("permission denied");
        return "";
      });

      // Should throw ConfigError containing the global config error
      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow("Error reading global config");
    });
  });

  describe("validateAgentConfig catch path", () => {
    it("pushes error when validateAgentConfig throws", async () => {
      mockValidateAgentConfig.mockReset();
      mockDiscoverAgents.mockReturnValue(["bad-agent"]);
      mockLoadAgentConfig.mockReturnValue({ name: "bad-agent", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({ name: "bad-agent" });
      mockCollectCredentialRefs.mockReturnValue(new Set());
      mockCredentialExists.mockReturnValue(true);

      // Make validateAgentConfig (from config.js) throw
      mockValidateAgentConfig.mockImplementation(() => {
        throw new Error("invalid agent name from validate");
      });

      // Should throw ConfigError containing the validation error
      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow("invalid agent name from validate");
    });
  });

  describe("outer agent validation catch path", () => {
    it("catches errors thrown during agent validation loop", async () => {
      mockValidateAgentConfig.mockReset();
      mockDiscoverAgents.mockReturnValue(["broken-agent"]);
      mockLoadAgentConfig.mockReturnValue({ name: "broken-agent", credentials: [] });
      mockCollectCredentialRefs.mockReturnValue(new Set());
      mockCredentialExists.mockReturnValue(true);

      // Make loadAgentRuntimeConfig throw unexpectedly
      mockLoadAgentRuntimeConfig.mockImplementation(() => {
        throw new Error("config file corrupted");
      });

      // Should throw ConfigError containing the agent error
      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow("config file corrupted");
    });
  });

  // Only run these tests on Linux (where isLinux=true in doctor.ts)
  describe("host-user user creation fail (Linux, no checkOnly)", () => {
    it("records error when useradd fails", async () => {
      if (process.platform !== "linux") return; // Skip on non-Linux

      mockValidateAgentConfig.mockReset();
      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({ runtime: { type: "host-user" } });
      mockCredentialExists.mockReturnValue(true);
      mockCollectCredentialRefs.mockReturnValue(new Set());

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        // User doesn't exist (id throws)
        if (cmd === "id" && args[0] === "al-agent") throw new Error("no such user");
        // useradd fails
        if (cmd === "sudo" && args[0] === "useradd") throw new Error("useradd failed");
        // Other commands succeed
        if (cmd === "sudo") return Buffer.from("");
        if (cmd === "getent") throw new Error("no docker");
        return Buffer.from("");
      });

      // Should throw ConfigError with user creation error message
      await expect(execute({ project: ".", skipCredentials: true })).rejects.toThrow("Failed to create user");
    });
  });

  describe("host-user docker group usermod (Linux, no checkOnly)", () => {
    it("adds user to docker group and logs success", async () => {
      if (process.platform !== "linux") return; // Skip on non-Linux

      mockValidateAgentConfig.mockReset();
      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({ runtime: { type: "host-user" } });
      mockCredentialExists.mockReturnValue(true);
      mockCollectCredentialRefs.mockReturnValue(new Set());

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        // User exists
        if (cmd === "id" && args[0] === "al-agent") return Buffer.from("1001");
        // sudo -n check succeeds
        if (cmd === "sudo" && args[0] === "-n") return Buffer.from("");
        // sudoers tee succeeds
        if (cmd === "sudo" && args[0] === "tee") return Buffer.from("");
        // sudoers chmod succeeds
        if (cmd === "sudo" && args[0] === "chmod") return Buffer.from("");
        // docker group exists
        if (cmd === "getent" && args[0] === "group" && args[1] === "docker") return Buffer.from("docker:x:999:");
        // User NOT in docker group
        if (cmd === "id" && args[0] === "-Gn") return Buffer.from("al-agent");
        // usermod succeeds (not checkOnly, so this path runs)
        if (cmd === "sudo" && args[0] === "usermod") return Buffer.from("");
        throw new Error(`unexpected: ${cmd} ${args.join(" ")}`);
      });

      const output = await captureLog(() =>
        execute({ project: ".", skipCredentials: true })
      );
      expect(output).toContain("Added");
      expect(output).toContain("docker group");
    });

    it("warns when usermod fails to add user to docker group", async () => {
      if (process.platform !== "linux") return; // Skip on non-Linux

      mockValidateAgentConfig.mockReset();
      mockDiscoverAgents.mockReturnValue(["e2e"]);
      mockLoadAgentConfig.mockReturnValue({ name: "e2e", credentials: [] });
      mockLoadAgentRuntimeConfig.mockReturnValue({ runtime: { type: "host-user" } });
      mockCredentialExists.mockReturnValue(true);
      mockCollectCredentialRefs.mockReturnValue(new Set());

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        // User exists
        if (cmd === "id" && args[0] === "al-agent") return Buffer.from("1001");
        // sudo -n check succeeds
        if (cmd === "sudo" && args[0] === "-n") return Buffer.from("");
        // sudoers tee and chmod succeed
        if (cmd === "sudo" && args[0] === "tee") return Buffer.from("");
        if (cmd === "sudo" && args[0] === "chmod") return Buffer.from("");
        // docker group exists
        if (cmd === "getent" && args[0] === "group" && args[1] === "docker") return Buffer.from("docker:x:999:");
        // User NOT in docker group
        if (cmd === "id" && args[0] === "-Gn") return Buffer.from("al-agent");
        // usermod FAILS
        if (cmd === "sudo" && args[0] === "usermod") throw new Error("usermod: permission denied");
        throw new Error(`unexpected: ${cmd} ${args.join(" ")}`);
      });

      const output = await captureLog(() =>
        execute({ project: ".", skipCredentials: true })
      );
      // Should warn about docker group
      expect(output).toContain("docker group");
    });
  });
});
