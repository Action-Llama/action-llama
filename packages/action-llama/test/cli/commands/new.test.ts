import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

const mockPromptCredential = vi.fn();
vi.mock("../../../src/credentials/prompter.js", () => ({
  promptCredential: (...args: any[]) => mockPromptCredential(...args),
}));

const mockResolveCredential = vi.fn();
vi.mock("../../../src/credentials/registry.js", () => ({
  resolveCredential: (...args: any[]) => mockResolveCredential(...args),
}));

const mockWriteCredentialFields = vi.fn();
const mockLoadCredentialField = vi.fn();
vi.mock("../../../src/shared/credentials.js", () => ({
  loadCredentialField: (...args: any[]) => mockLoadCredentialField(...args),
  writeCredentialFields: (...args: any[]) => mockWriteCredentialFields(...args),
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  requireCredentialRef: () => {},
  credentialExists: () => true,
  writeCredentialField: () => {},
  backendLoadField: (...args: any[]) => Promise.resolve(mockLoadCredentialField(...args)),
  backendLoadFields: () => Promise.resolve({}),
  backendCredentialExists: () => Promise.resolve(true),
  backendListInstances: () => Promise.resolve([]),
  backendRequireCredentialRef: () => Promise.resolve(),
  getDefaultBackend: () => {},
  setDefaultBackend: () => {},
  resetDefaultBackend: () => {},
}));

const mockScaffoldProject = vi.fn();
vi.mock("../../../src/setup/scaffold.js", () => ({
  scaffoldProject: (...args: any[]) => mockScaffoldProject(...args),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock inquirer prompts
const mockSelect = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  select: (...args: any[]) => mockSelect(...args),
}));

import { execute } from "../../../src/cli/commands/new.js";

describe("new", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCredentialField.mockReturnValue(undefined);
    
    // Default to Anthropic selection
    mockSelect.mockImplementation(({ choices, default: defaultValue }) => {
      if (choices.some((c: any) => c.value === "anthropic")) {
        return Promise.resolve("anthropic");
      }
      // For model selection, return the default
      return Promise.resolve(defaultValue);
    });

    mockResolveCredential.mockImplementation((id: string) => {
      if (id === "anthropic_key") {
        return {
          id: "anthropic_key",
          label: "Anthropic API Credential",
          fields: [{ name: "token", label: "API Key", secret: true }],
        };
      } else if (id === "openai_key") {
        return {
          id: "openai_key",
          label: "OpenAI API Credential",
          fields: [{ name: "token", label: "API Key", secret: true }],
        };
      }
      throw new Error(`Unknown credential: ${id}`);
    });
  });

  it("throws when no project name given", async () => {
    await expect(execute("")).rejects.toThrow();
  });

  it("writes new anthropic credential when anthropic provider selected", async () => {
    mockPromptCredential.mockResolvedValue({
      values: { token: "sk-ant-api-new" },
      params: { authType: "api_key" },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("anthropic_key", "default", { token: "sk-ant-api-new" });
    expect(output).toContain("Setup complete!");
    expect(output).toContain("Provider:    anthropic");
  });

  it("writes new openai credential when openai provider selected", async () => {
    // Mock selecting OpenAI provider and gpt-4o model
    mockSelect.mockImplementation(({ choices }) => {
      if (choices.some((c: any) => c.value === "anthropic")) {
        return Promise.resolve("openai");
      }
      return Promise.resolve("gpt-4o");
    });

    mockPromptCredential.mockResolvedValue({
      values: { token: "sk-openai-new" },
      params: { authType: "api_key" },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockResolveCredential).toHaveBeenCalledWith("openai_key");
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("openai_key", "default", { token: "sk-openai-new" });
    expect(output).toContain("Setup complete!");
    expect(output).toContain("Provider:    openai");
    expect(output).toContain("Model:       gpt-4o");
    
    // Check that the scaffold was called with OpenAI config
    expect(mockScaffoldProject).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        models: expect.objectContaining({
          gpt4o: expect.objectContaining({
            provider: "openai",
            model: "gpt-4o",
            authType: "api_key",
          }),
        }),
      }),
      [],
      "my-project"
    );
  });

  it("skips unchanged anthropic credential", async () => {
    mockLoadCredentialField.mockReturnValue("sk-ant-api-existing");
    mockPromptCredential.mockResolvedValue({
      values: { token: "sk-ant-api-existing" },
      params: { authType: "api_key" },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredentialFields).not.toHaveBeenCalled();
    expect(output).toContain("Anthropic key unchanged");
  });

  it("handles pi_auth (no anthropic key file)", async () => {
    mockPromptCredential.mockResolvedValue({
      values: {},
      params: { authType: "pi_auth" },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredentialFields).not.toHaveBeenCalled();
    expect(output).toContain("Using existing pi auth");
  });

  it("handles no OpenAI key provided", async () => {
    // Mock selecting OpenAI provider
    mockSelect.mockImplementation(({ choices }) => {
      if (choices.some((c: any) => c.value === "anthropic")) {
        return Promise.resolve("openai");
      }
      return Promise.resolve("gpt-4o");
    });

    mockPromptCredential.mockResolvedValue({
      values: {},
      params: {},
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredentialFields).not.toHaveBeenCalled();
    expect(output).toContain("No API key provided - you'll need to configure it later with 'al doctor'");
    
    // Should still create the project with api_key auth type but no credentials
    expect(mockScaffoldProject).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        models: expect.objectContaining({
          gpt4o: expect.objectContaining({
            provider: "openai",
            authType: "api_key",
          }),
        }),
      }),
      [],
      "my-project"
    );
  });

  // ─── non-interactive mode ────────────────────────────────────────────────

  describe("non-interactive mode (opts.interactive === false)", () => {
    it("uses anthropic provider by default", async () => {
      const output = await captureLog(() =>
        execute("my-project", { interactive: false })
      );

      expect(mockSelect).not.toHaveBeenCalled();
      expect(output).toContain("Model Provider: anthropic (non-interactive)");
      expect(output).toContain("Skipping credential setup");
      expect(output).toContain("Setup complete!");
    });

    it("uses provided provider and model in non-interactive mode", async () => {
      const output = await captureLog(() =>
        execute("my-project", { interactive: false, provider: "openai", model: "gpt-4o" })
      );

      expect(mockSelect).not.toHaveBeenCalled();
      expect(output).toContain("Model Provider: openai (non-interactive)");
      expect(output).toContain("Model: gpt-4o (non-interactive)");
      expect(output).toContain("You'll need to configure API key later");

      expect(mockScaffoldProject).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          models: expect.objectContaining({
            gpt4o: expect.objectContaining({
              provider: "openai",
              model: "gpt-4o",
            }),
          }),
        }),
        [],
        "my-project"
      );
    });

    it("defaults to claude-sonnet-4 with thinkingLevel medium when anthropic and no model specified", async () => {
      await captureLog(() =>
        execute("my-project", { interactive: false, provider: "anthropic" })
      );

      expect(mockScaffoldProject).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          models: expect.objectContaining({
            sonnet: expect.objectContaining({
              provider: "anthropic",
              model: "claude-sonnet-4-20250514",
              thinkingLevel: "medium",
            }),
          }),
        }),
        [],
        "my-project"
      );
    });

    it("defaults to gpt-4o when openai and no model specified", async () => {
      const output = await captureLog(() =>
        execute("my-project", { interactive: false, provider: "openai" })
      );

      expect(output).toContain("Model: gpt-4o (non-interactive)");
      expect(mockScaffoldProject).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          models: expect.objectContaining({
            gpt4o: expect.objectContaining({
              provider: "openai",
              model: "gpt-4o",
            }),
          }),
        }),
        [],
        "my-project"
      );
    });

    it("logs anthropic pi auth message in non-interactive anthropic mode", async () => {
      const output = await captureLog(() =>
        execute("my-project", { interactive: false, provider: "anthropic" })
      );

      expect(output).toContain("Will use existing pi auth");
    });
  });
});
