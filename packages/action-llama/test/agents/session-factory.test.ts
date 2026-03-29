import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetModel = vi.fn();
const mockAuthStorageCreate = vi.fn();
const mockSetRuntimeApiKey = vi.fn();
const mockCreateAgentSession = vi.fn();
const mockCreateCodingTools = vi.fn();
const mockSessionManagerInMemory = vi.fn();

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: (...args: any[]) => mockGetModel(...args),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: {
    create: (...args: any[]) => mockAuthStorageCreate(...args),
  },
  createAgentSession: (...args: any[]) => mockCreateAgentSession(...args),
  createCodingTools: (...args: any[]) => mockCreateCodingTools(...args),
  SessionManager: {
    inMemory: (...args: any[]) => mockSessionManagerInMemory(...args),
  },
}));

import { createSessionForModel } from "../../src/agents/session-factory.js";
import type { ModelConfig } from "../../src/shared/config.js";

const makeModelConfig = (overrides?: Partial<ModelConfig>): ModelConfig => ({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinkingLevel: "medium",
  authType: "api_key",
  ...overrides,
});

const makeOpts = (overrides?: any) => ({
  cwd: "/tmp/project",
  resourceLoader: {},
  settingsManager: {},
  loadCredential: vi.fn().mockResolvedValue("fake-api-key"),
  ...overrides,
});

describe("createSessionForModel", () => {
  let mockAuthStorage: any;
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthStorage = {
      setRuntimeApiKey: mockSetRuntimeApiKey,
    };
    mockSession = {
      subscribe: vi.fn(),
      prompt: vi.fn(),
      dispose: vi.fn(),
    };

    mockGetModel.mockReturnValue({ provider: "anthropic", model: "claude-sonnet-4" });
    mockAuthStorageCreate.mockReturnValue(mockAuthStorage);
    mockCreateCodingTools.mockReturnValue([]);
    mockSessionManagerInMemory.mockReturnValue({});
    mockCreateAgentSession.mockResolvedValue({ session: mockSession });
  });

  it("calls getModel with provider and model from config", async () => {
    const config = makeModelConfig({ provider: "anthropic", model: "claude-sonnet-4" });

    await createSessionForModel(config, makeOpts());

    expect(mockGetModel).toHaveBeenCalledOnce();
    expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4");
  });

  it("creates an AuthStorage via AuthStorage.create()", async () => {
    const config = makeModelConfig();

    await createSessionForModel(config, makeOpts());

    expect(mockAuthStorageCreate).toHaveBeenCalledOnce();
  });

  it("loads credential and sets runtime API key when authType is api_key", async () => {
    const config = makeModelConfig({ authType: "api_key", provider: "openai" });
    const opts = makeOpts({ loadCredential: vi.fn().mockResolvedValue("my-openai-key") });

    await createSessionForModel(config, opts);

    expect(opts.loadCredential).toHaveBeenCalledWith("openai_key", "default", "token");
    expect(mockSetRuntimeApiKey).toHaveBeenCalledWith("openai", "my-openai-key");
  });

  it("does not set runtime API key when authType is pi_auth", async () => {
    const config = makeModelConfig({ authType: "pi_auth" });
    const opts = makeOpts();

    await createSessionForModel(config, opts);

    expect(opts.loadCredential).not.toHaveBeenCalled();
    expect(mockSetRuntimeApiKey).not.toHaveBeenCalled();
  });

  it("does not set runtime API key when credential is undefined", async () => {
    const config = makeModelConfig({ authType: "api_key" });
    const opts = makeOpts({ loadCredential: vi.fn().mockResolvedValue(undefined) });

    await createSessionForModel(config, opts);

    expect(mockSetRuntimeApiKey).not.toHaveBeenCalled();
  });

  it("calls createAgentSession with cwd from opts", async () => {
    const config = makeModelConfig();
    const opts = makeOpts({ cwd: "/custom/path" });

    await createSessionForModel(config, opts);

    expect(mockCreateAgentSession).toHaveBeenCalledOnce();
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/custom/path" })
    );
  });

  it("calls createAgentSession with thinkingLevel from config", async () => {
    const config = makeModelConfig({ thinkingLevel: "high" });

    await createSessionForModel(config, makeOpts());

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: "high" })
    );
  });

  it("returns session and authStorage", async () => {
    const config = makeModelConfig();

    const result = await createSessionForModel(config, makeOpts());

    expect(result.session).toBe(mockSession);
    expect(result.authStorage).toBe(mockAuthStorage);
  });
});
