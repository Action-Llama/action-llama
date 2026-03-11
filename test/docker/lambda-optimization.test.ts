import { describe, it, expect, vi, beforeEach } from "vitest";
import { LambdaOptimizer, LambdaPerformanceMonitor } from "../../src/docker/lambda-optimization.js";

describe("Lambda Optimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("LambdaOptimizer", () => {
    it("should initialize with correct region", () => {
      const optimizer = new LambdaOptimizer({ awsRegion: "us-east-1" });
      expect(optimizer).toBeInstanceOf(LambdaOptimizer);
    });

    it("should handle pre-warm function errors gracefully", async () => {
      const mockSend = vi.fn().mockRejectedValue(new Error("Function not found"));
      const optimizer = new LambdaOptimizer({ awsRegion: "us-east-1" });
      // @ts-ignore
      optimizer.lambdaClient = { send: mockSend };

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await optimizer.preWarmFunction("test-agent");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to pre-warm function")
      );

      consoleSpy.mockRestore();
    });
  });

  describe("LambdaPerformanceMonitor", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      delete process.env.AWS_LAMBDA_INITIALIZATION_TYPE;
      delete process.env.AWS_LAMBDA_LOG_STREAM_NAME;
    });

    it("should log cold start detection", () => {
      process.env.AWS_LAMBDA_INITIALIZATION_TYPE = "on-demand";
      process.env.AWS_LAMBDA_LOG_STREAM_NAME = "test-stream";

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      LambdaPerformanceMonitor.logColdStart(false);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"msg":"cold start detected"')
      );

      consoleSpy.mockRestore();
    });

    it("should log warm start", () => {
      process.env.AWS_LAMBDA_INITIALIZATION_TYPE = "provisioned";
      process.env.AWS_LAMBDA_LOG_STREAM_NAME = "test-stream";

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      LambdaPerformanceMonitor.logColdStart(false);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"msg":"warm start"')
      );

      consoleSpy.mockRestore();
    });

    it("should log performance metrics", () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const metrics = {
        initTimeMs: 100,
        credentialsTimeMs: 50,
        sessionCreationTimeMs: 200,
        totalStartupTimeMs: 350,
      };

      LambdaPerformanceMonitor.logPerformanceMetrics(metrics);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"msg":"performance metrics"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"initTimeMs":100')
      );

      consoleSpy.mockRestore();
    });
  });
});