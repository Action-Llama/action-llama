import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TelemetryManager, initTelemetry, getTelemetry } from "../../src/telemetry/index.js";
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
  });
});