import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock extensions loader
const mockLoadBuiltinExtensions = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/extensions/loader.js", () => ({
  loadBuiltinExtensions: (...args: any[]) => mockLoadBuiltinExtensions(...args),
  isExtension: (obj: any) => obj !== null && typeof obj === "object" && "metadata" in obj,
  getGlobalRegistry: () => ({}),
}));

// Mock telemetry
const mockTelemetryInit = vi.fn().mockResolvedValue(undefined);
const mockTelemetryShutdown = vi.fn().mockResolvedValue(undefined);
const mockInitTelemetry = vi.fn().mockReturnValue({
  init: mockTelemetryInit,
  shutdown: mockTelemetryShutdown,
});
vi.mock("../../src/telemetry/index.js", () => ({
  initTelemetry: (...args: any[]) => mockInitTelemetry(...args),
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

  it("calls loadBuiltinExtensions with providers from globalConfig.models", async () => {
    const globalConfig = {
      models: {
        sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        gpt: { provider: "openai", model: "gpt-4o", authType: "api_key" },
      },
    } as any;
    const logger = makeLogger();

    await loadDependencies(globalConfig, logger);

    expect(mockLoadBuiltinExtensions).toHaveBeenCalledWith(
      undefined,
      new Set(["anthropic", "openai"])
    );
  });

  it("calls loadBuiltinExtensions with undefined providers when no models in config", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    await loadDependencies(globalConfig, logger);

    expect(mockLoadBuiltinExtensions).toHaveBeenCalledWith(undefined, undefined);
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

  it("initializes telemetry when globalConfig.telemetry.enabled is true", async () => {
    const globalConfig = {
      telemetry: {
        enabled: true,
        provider: "otel",
        endpoint: "http://localhost:4317",
        serviceName: "test",
      },
    } as any;
    const logger = makeLogger();

    const result = await loadDependencies(globalConfig, logger);

    expect(mockInitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, provider: "otel" })
    );
    expect(mockTelemetryInit).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("Telemetry initialized successfully");
    expect(result.telemetry).toBeDefined();
  });

  it("returns undefined telemetry when globalConfig.telemetry.enabled is false", async () => {
    const globalConfig = {
      telemetry: { enabled: false },
    } as any;
    const logger = makeLogger();

    const result = await loadDependencies(globalConfig, logger);

    expect(mockInitTelemetry).not.toHaveBeenCalled();
    expect(result.telemetry).toBeUndefined();
  });

  it("returns undefined telemetry when telemetry config is absent", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    const result = await loadDependencies(globalConfig, logger);

    expect(mockInitTelemetry).not.toHaveBeenCalled();
    expect(result.telemetry).toBeUndefined();
  });

  it("logs warning and continues when telemetry init throws", async () => {
    mockTelemetryInit.mockRejectedValueOnce(new Error("otel init failed"));
    const globalConfig = {
      telemetry: { enabled: true, provider: "otel" },
    } as any;
    const logger = makeLogger();

    const result = await loadDependencies(globalConfig, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "otel init failed" }),
      "Failed to initialize telemetry"
    );
    expect(result).toBeDefined(); // does not throw
  });
});
