import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock extensions loader
const mockLoadBuiltinExtensions = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/extensions/loader.js", () => ({
  loadBuiltinExtensions: (...args: any[]) => mockLoadBuiltinExtensions(...args),
  isExtension: (obj: any) => obj !== null && typeof obj === "object" && "metadata" in obj,
  getGlobalRegistry: () => ({}),
}));

import { loadDependencies } from "../../src/scheduler/dependencies.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as any;
}

describe("loadDependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls loadBuiltinExtensions with models in config", async () => {
    const globalConfig = {
      models: {
        sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        gpt: { provider: "openai", model: "gpt-4o", authType: "api_key" },
      },
    } as any;
    const logger = makeLogger();

    await loadDependencies(globalConfig, logger);

    expect(mockLoadBuiltinExtensions).toHaveBeenCalledWith();
  });

  it("calls loadBuiltinExtensions with no models in config", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    await loadDependencies(globalConfig, logger);

    expect(mockLoadBuiltinExtensions).toHaveBeenCalledWith();
  });

  it("logs success when loadBuiltinExtensions resolves", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    await loadDependencies(globalConfig, logger);

    expect(logger.info).toHaveBeenCalledWith("Extensions loaded successfully");
  });

  it("logs warning and continues when loadBuiltinExtensions throws", async () => {
    mockLoadBuiltinExtensions.mockRejectedValueOnce(new Error("ext load failed"));
    const globalConfig = {} as any;
    const logger = makeLogger();

    const result = await loadDependencies(globalConfig, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ext load failed" }),
      "Failed to load extensions"
    );
    expect(result).toBeDefined(); // does not throw
  });

});
