import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import { TelemetryManager, initTelemetry, getTelemetry, createSpan, withSpan } from "../../src/telemetry/index.js";
import type { TelemetryConfig } from "../../src/telemetry/types.js";

describe("Telemetry", () => {
  let telemetry: TelemetryManager;

  afterEach(async () => {
    if (telemetry) {
      await telemetry.shutdown();
    }
  });

  describe("TelemetryManager", () => {
    it("should initialize with disabled config", async () => {
      const config: TelemetryConfig = {
        enabled: false,
        provider: "none",
      };
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      expect(telemetry).toBeDefined();
    });

    it("should initialize with OpenTelemetry config", async () => {
      const config: TelemetryConfig = {
        enabled: true,
        provider: "otel",
        serviceName: "test-service",
        endpoint: "http://localhost:4317",
        samplingRate: 1.0,
      };
      
      telemetry = new TelemetryManager(config);
      // Note: This will fail in test environment without actual OTEL collector
      // but should not throw as telemetry failures are caught
      await telemetry.init();
      
      expect(telemetry).toBeDefined();
    });

    it("should not reinitialize when already initialized", async () => {
      const config: TelemetryConfig = {
        enabled: false,
        provider: "none",
      };
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      await telemetry.init(); // second call should be a no-op
      
      expect(telemetry).toBeDefined();
    });

    it("should warn and skip init for unknown telemetry provider", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      
      const config: TelemetryConfig = {
        enabled: true,
        provider: "otel",
        serviceName: "test-service",
      };
      
      // Mock the registry to return undefined for the provider
      const { globalRegistry } = await import("../../src/extensions/registry.js");
      vi.spyOn(globalRegistry, "getTelemetryExtension").mockReturnValue(undefined);
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown telemetry provider"));
      
      warnSpy.mockRestore();
    });

    it("should create spans with attributes", async () => {
      const config: TelemetryConfig = {
        enabled: false, // Use no-op mode for testing
        provider: "none",
      };
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const span = telemetry.createSpan("test.span", {
        "agent.name": "test-agent",
        "execution.result": "success",
      });
      
      expect(span).toBeDefined();
      expect(typeof span.end).toBe("function");
      span.end();
    });

    it("should create spans with custom kind", async () => {
      const config: TelemetryConfig = {
        enabled: false,
        provider: "none",
      };
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const span = telemetry.createSpan("test.span", {}, SpanKind.CLIENT);
      expect(span).toBeDefined();
      span.end();
    });

    it("should execute functions within spans", async () => {
      const config: TelemetryConfig = {
        enabled: false,
        provider: "none",
      };
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const result = await telemetry.withSpan(
        "test.operation",
        async (span) => {
          expect(span).toBeDefined();
          return "test-result";
        },
        { "test.attribute": "test-value" }
      );
      
      expect(result).toBe("test-result");
    });

    it("should handle errors in span execution", async () => {
      const config: TelemetryConfig = {
        enabled: false,
        provider: "none",
      };
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      await expect(
        telemetry.withSpan(
          "test.error",
          async () => {
            throw new Error("Test error");
          }
        )
      ).rejects.toThrow("Test error");
    });

    it("should set span status to success", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const span = telemetry.createSpan("test.span");
      // setSpanStatus should not throw for noop spans
      expect(() => telemetry.setSpanStatus(span, "success")).not.toThrow();
      expect(() => telemetry.setSpanStatus(span, "success", "all good")).not.toThrow();
      span.end();
    });

    it("should set span status to error", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const span = telemetry.createSpan("test.span");
      expect(() => telemetry.setSpanStatus(span, "error", "something failed")).not.toThrow();
      span.end();
    });

    it("should set span status to timeout", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const span = telemetry.createSpan("test.span");
      expect(() => telemetry.setSpanStatus(span, "timeout")).not.toThrow();
      expect(() => telemetry.setSpanStatus(span, "timeout", "timed out after 30s")).not.toThrow();
      span.end();
    });

    it("should return undefined for active context when not initialized", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const ctx = telemetry.getActiveContext();
      expect(ctx).toBeUndefined();
    });

    it("should return undefined for active context when provider is none", async () => {
      const config: TelemetryConfig = { enabled: true, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      const ctx = telemetry.getActiveContext();
      expect(ctx).toBeUndefined();
    });

    it("should not throw when setTraceContext called while not initialized", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      // Not initialized, should return early without throwing
      expect(() => telemetry.setTraceContext("00-abc123-def456-01")).not.toThrow();
    });

    it("should not throw when setTraceContext called with empty string", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      expect(() => telemetry.setTraceContext("")).not.toThrow();
    });

    it("should shutdown without a provider without throwing", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      // Should complete without throwing even if no provider
      await expect(telemetry.shutdown()).resolves.toBeUndefined();
    });

    it("should handle provider shutdown error gracefully", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      
      const config: TelemetryConfig = {
        enabled: true,
        provider: "otel",
        serviceName: "test-service",
      };
      
      const { globalRegistry } = await import("../../src/extensions/registry.js");
      const mockProvider = {
        init: vi.fn().mockResolvedValue(undefined),
        getTracer: vi.fn().mockReturnValue({ startSpan: vi.fn().mockReturnValue({ end: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), setAttribute: vi.fn() }) }),
        shutdown: vi.fn().mockRejectedValue(new Error("shutdown error")),
      };
      vi.spyOn(globalRegistry, "getTelemetryExtension").mockReturnValue({ provider: mockProvider } as any);
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      
      // shutdown should catch the provider error
      await expect(telemetry.shutdown()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith("Error during telemetry shutdown:", expect.any(Error));
      
      warnSpy.mockRestore();
    });

    it("should reset initialized flag after shutdown", async () => {
      const config: TelemetryConfig = {
        enabled: true,
        provider: "otel",
        serviceName: "test-service",
      };
      
      const { globalRegistry } = await import("../../src/extensions/registry.js");
      const mockProvider = {
        init: vi.fn().mockResolvedValue(undefined),
        getTracer: vi.fn().mockReturnValue({ startSpan: vi.fn().mockReturnValue({ end: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), setAttribute: vi.fn() }) }),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(globalRegistry, "getTelemetryExtension").mockReturnValue({ provider: mockProvider } as any);
      
      telemetry = new TelemetryManager(config);
      await telemetry.init();
      await telemetry.shutdown();
      
      // After shutdown, should be able to reinitialize
      vi.spyOn(globalRegistry, "getTelemetryExtension").mockReturnValue({ provider: mockProvider } as any);
      await telemetry.init();
      expect(mockProvider.init).toHaveBeenCalledTimes(2);
    });
  });

  describe("Global telemetry", () => {
    it("should initialize and retrieve global instance", async () => {
      const config: TelemetryConfig = {
        enabled: false,
        provider: "none",
      };
      
      const instance = initTelemetry(config);
      expect(instance).toBeDefined();
      
      const retrieved = getTelemetry();
      expect(retrieved).toBe(instance);
      
      await instance.shutdown();
    });

    it("should create span via global createSpan with active global telemetry", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      const instance = initTelemetry(config);
      await instance.init();
      
      const span = createSpan("global.test.span", { "agent.name": "test" });
      expect(span).toBeDefined();
      expect(typeof span.end).toBe("function");
      span.end();
      
      await instance.shutdown();
    });

    it("should create span via global createSpan with custom kind", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      const instance = initTelemetry(config);
      await instance.init();
      
      const span = createSpan("global.test.span", {}, SpanKind.SERVER);
      expect(span).toBeDefined();
      span.end();
      
      await instance.shutdown();
    });

    it("should execute withSpan globally with active global telemetry", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      const instance = initTelemetry(config);
      await instance.init();
      
      const result = await withSpan("global.operation", async (span) => {
        expect(span).toBeDefined();
        return 42;
      });
      
      expect(result).toBe(42);
      
      await instance.shutdown();
    });

    it("should execute withSpan globally and propagate errors", async () => {
      const config: TelemetryConfig = { enabled: false, provider: "none" };
      const instance = initTelemetry(config);
      await instance.init();
      
      await expect(
        withSpan("global.error", async () => {
          throw new Error("global span error");
        })
      ).rejects.toThrow("global span error");
      
      await instance.shutdown();
    });
  });
});
