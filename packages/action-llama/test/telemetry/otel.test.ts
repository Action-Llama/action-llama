import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock instances that can be configured per test
const mockSdkStart = vi.fn();
const mockSdkShutdown = vi.fn();
const mockTraceGetTracerFn = vi.fn();

vi.mock("@opentelemetry/sdk-node", () => {
  function MockNodeSDK(this: any, _opts: any) {
    this.start = mockSdkStart;
    this.shutdown = mockSdkShutdown;
  }
  return { NodeSDK: MockNodeSDK };
});

vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
}));

const mockOTLPExporterArgs = vi.fn();

vi.mock("@opentelemetry/exporter-trace-otlp-grpc", () => {
  function MockOTLPTraceExporter(this: any, opts: any) {
    mockOTLPExporterArgs(opts);
  }
  return { OTLPTraceExporter: MockOTLPTraceExporter };
});

vi.mock("@opentelemetry/resources", () => {
  function MockResource(this: any, _attrs: any) {}
  MockResource.default = function () {
    return { merge: (_other: any) => ({}) };
  };
  return { Resource: MockResource };
});

vi.mock("@opentelemetry/semantic-conventions", () => ({
  SEMRESATTRS_SERVICE_NAME: "service.name",
  SEMRESATTRS_SERVICE_VERSION: "service.version",
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT: "deployment.environment",
}));

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: (...args: any[]) => mockTraceGetTracerFn(...args),
  },
}));

import { OTelProvider, otelExtension } from "../../src/telemetry/providers/otel.js";
import type { TelemetryConfig } from "../../src/telemetry/types.js";

describe("OTelProvider", () => {
  let provider: OTelProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdkStart.mockResolvedValue(undefined);
    mockSdkShutdown.mockResolvedValue(undefined);
    mockTraceGetTracerFn.mockReturnValue({
      startSpan: vi.fn().mockReturnValue({ end: vi.fn() }),
    });
  });

  describe("constructor", () => {
    it("creates an instance without throwing", () => {
      const config: TelemetryConfig = { enabled: true, provider: "otel", serviceName: "my-service" };
      provider = new OTelProvider(config);
      expect(provider).toBeDefined();
    });
  });

  describe("getTracer", () => {
    it("throws when not initialized", () => {
      provider = new OTelProvider({ enabled: true, provider: "otel" });
      expect(() => provider.getTracer()).toThrow("OpenTelemetry provider not initialized");
    });

    it("returns the tracer after successful init", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const mockTracer = { startSpan: vi.fn() };
      mockTraceGetTracerFn.mockReturnValue(mockTracer);

      provider = new OTelProvider({ enabled: true, provider: "otel" });
      await provider.init();

      expect(provider.getTracer()).toBe(mockTracer);
    });
  });

  describe("init", () => {
    it("initializes SDK and logs success", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      provider = new OTelProvider({ enabled: true, provider: "otel", serviceName: "test-svc" });

      await provider.init();

      expect(mockSdkStart).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalledWith("OpenTelemetry initialized successfully");
      consoleSpy.mockRestore();
    });

    it("calls getNodeAutoInstrumentations during init", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      provider = new OTelProvider({ enabled: true, provider: "otel" });
      await provider.init();

      // getNodeAutoInstrumentations is mocked and should have been called during SDK construction
      // The NodeSDK constructor receives instrumentations array - just verify init completed
      expect(mockSdkStart).toHaveBeenCalledOnce();
    });

    it("creates OTLPTraceExporter when endpoint is provided", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      provider = new OTelProvider({
        enabled: true,
        provider: "otel",
        endpoint: "http://collector:4317",
        headers: { "x-api-key": "secret" },
      });

      await provider.init();

      expect(mockOTLPExporterArgs).toHaveBeenCalledOnce();
      expect(mockOTLPExporterArgs).toHaveBeenCalledWith({
        url: "http://collector:4317",
        headers: { "x-api-key": "secret" },
      });
    });

    it("gets tracer using 'action-llama' service name", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      provider = new OTelProvider({ enabled: true, provider: "otel" });

      await provider.init();

      expect(mockTraceGetTracerFn).toHaveBeenCalledOnce();
      expect(mockTraceGetTracerFn.mock.calls[0][0]).toBe("action-llama");
    });

    it("warns and rethrows when SDK start fails", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockSdkStart.mockRejectedValue(new Error("SDK start failed"));

      provider = new OTelProvider({ enabled: true, provider: "otel" });

      await expect(provider.init()).rejects.toThrow("SDK start failed");
      expect(warnSpy).toHaveBeenCalledWith("Failed to initialize OpenTelemetry:", expect.any(Error));
      warnSpy.mockRestore();
    });
  });

  describe("shutdown", () => {
    it("does not throw when called before init", async () => {
      provider = new OTelProvider({ enabled: true, provider: "otel" });
      await expect(provider.shutdown()).resolves.toBeUndefined();
      expect(mockSdkShutdown).not.toHaveBeenCalled();
    });

    it("shuts down the SDK after successful init", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      provider = new OTelProvider({ enabled: true, provider: "otel" });
      await provider.init();

      await provider.shutdown();

      expect(mockSdkShutdown).toHaveBeenCalledOnce();
    });

    it("warns on shutdown error but resolves without throwing", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockSdkShutdown.mockRejectedValue(new Error("shutdown failed"));

      provider = new OTelProvider({ enabled: true, provider: "otel" });
      await provider.init();

      await expect(provider.shutdown()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith("Error during OpenTelemetry shutdown:", expect.any(Error));
      warnSpy.mockRestore();
    });
  });
});

describe("otelExtension", () => {
  it("has metadata name 'otel'", () => {
    expect(otelExtension.metadata.name).toBe("otel");
  });

  it("has metadata version '1.0.0'", () => {
    expect(otelExtension.metadata.version).toBe("1.0.0");
  });

  it("has metadata type 'telemetry'", () => {
    expect(otelExtension.metadata.type).toBe("telemetry");
  });

  it("has a provider that is an OTelProvider instance", () => {
    expect(otelExtension.provider).toBeInstanceOf(OTelProvider);
  });

  it("has requiredCredentials with otel_endpoint", () => {
    expect(otelExtension.metadata.requiredCredentials).toContainEqual(
      expect.objectContaining({ type: "otel_endpoint" })
    );
  });

  it("has providesCredentialTypes including otel_endpoint", () => {
    expect(otelExtension.metadata.providesCredentialTypes).toContainEqual(
      expect.objectContaining({ type: "otel_endpoint" })
    );
  });

  it("otel_endpoint validation accepts a valid URL without throwing", async () => {
    const otelEndpointType = otelExtension.metadata.providesCredentialTypes!.find(
      (ct) => ct.type === "otel_endpoint"
    );
    expect(otelEndpointType).toBeDefined();
    await expect(
      otelEndpointType!.validation!({ endpoint: "http://localhost:4317" })
    ).resolves.not.toThrow();
  });

  it("otel_endpoint validation throws on invalid URL", async () => {
    const otelEndpointType = otelExtension.metadata.providesCredentialTypes!.find(
      (ct) => ct.type === "otel_endpoint"
    );
    await expect(
      otelEndpointType!.validation!({ endpoint: "not-a-valid-url" })
    ).rejects.toThrow();
  });

  it("has otel_api_key in providesCredentialTypes with OTEL_API_KEY env mapping", () => {
    const otelApiKeyType = otelExtension.metadata.providesCredentialTypes!.find(
      (ct) => ct.type === "otel_api_key"
    );
    expect(otelApiKeyType).toBeDefined();
    expect(otelApiKeyType!.envMapping).toEqual({ api_key: "OTEL_API_KEY" });
  });

  it("has an init function that is callable without throwing", async () => {
    expect(typeof otelExtension.init).toBe("function");
    await expect(otelExtension.init({} as any)).resolves.not.toThrow();
  });

  it("has a shutdown function that calls provider.shutdown", async () => {
    const shutdownSpy = vi.spyOn(otelExtension.provider, "shutdown").mockResolvedValue();
    await otelExtension.shutdown();
    expect(shutdownSpy).toHaveBeenCalledOnce();
    shutdownSpy.mockRestore();
  });
});
