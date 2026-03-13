import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";
import { propagation } from "@opentelemetry/api";
import { OTelProvider } from "./otel.js";
import type { TelemetryConfig } from "../types.js";

/**
 * AWS X-Ray provider implementation extending OpenTelemetry
 */
export class XRayProvider extends OTelProvider {
  constructor(config: TelemetryConfig) {
    super(config);
  }

  async init(): Promise<void> {
    try {
      // Set up X-Ray propagator
      propagation.setGlobalPropagator(new AWSXRayPropagator());

      // Initialize the base OpenTelemetry provider
      await super.init();

      console.log("AWS X-Ray telemetry initialized successfully");
    } catch (error) {
      console.warn("Failed to initialize AWS X-Ray telemetry:", error);
      throw error;
    }
  }

  protected createIdGenerator() {
    return new AWSXRayIdGenerator();
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    console.log("AWS X-Ray telemetry shutdown completed");
  }
}