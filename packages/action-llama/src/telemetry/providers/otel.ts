import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from "@opentelemetry/semantic-conventions";
import { trace, Tracer } from "@opentelemetry/api";
import type { TelemetryConfig, TelemetryProvider } from "../types.js";
import type { TelemetryExtension } from "../../extensions/types.js";

/**
 * OpenTelemetry provider implementation
 */
export class OTelProvider implements TelemetryProvider {
  private sdk?: NodeSDK;
  private config: TelemetryConfig;
  private tracer?: Tracer;

  constructor(config: TelemetryConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    try {
      // Create resource with service information
      const resource = Resource.default().merge(
        new Resource({
          [SEMRESATTRS_SERVICE_NAME]: this.config.serviceName || "action-llama",
          [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version || "unknown",
          [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || "development",
          "service.instance.id": process.env.HOSTNAME || process.pid.toString(),
        })
      );

      // Configure trace exporter
      let traceExporter;
      if (this.config.endpoint) {
        traceExporter = new OTLPTraceExporter({
          url: this.config.endpoint,
          headers: this.config.headers || {},
        });
      }

      // Initialize NodeSDK
      this.sdk = new NodeSDK({
        resource,
        traceExporter,
        instrumentations: [
          getNodeAutoInstrumentations({
            // Disable some instrumentations that might be too noisy
            "@opentelemetry/instrumentation-fs": {
              enabled: false,
            },
          }),
        ],
        // Note: samplerConfig is not supported, use sampler instead
      });

      // Start the SDK
      await this.sdk.start();

      // Get tracer
      this.tracer = trace.getTracer("action-llama", process.env.npm_package_version);

      console.log("OpenTelemetry initialized successfully");
    } catch (error) {
      console.warn("Failed to initialize OpenTelemetry:", error);
      throw error;
    }
  }

  getTracer(): Tracer {
    if (!this.tracer) {
      throw new Error("OpenTelemetry provider not initialized");
    }
    return this.tracer;
  }

  async shutdown(): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.shutdown();
        console.log("OpenTelemetry shutdown completed");
      } catch (error) {
        console.warn("Error during OpenTelemetry shutdown:", error);
      }
    }
  }
}

/**
 * OpenTelemetry extension wrapper
 */
export const otelExtension: TelemetryExtension = {
  metadata: {
    name: "otel",
    version: "1.0.0",
    description: "OpenTelemetry provider",
    type: "telemetry",
    requiredCredentials: [
      { type: "otel_endpoint", description: "OTLP collector endpoint URL" },
      { type: "otel_api_key", description: "API key for authentication", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "otel_endpoint",
        fields: ["endpoint"],
        description: "OpenTelemetry collector endpoint",
        validation: async (values) => {
          // Validate URL format
          new URL(values.endpoint);
        }
      },
      {
        type: "otel_api_key", 
        fields: ["api_key"],
        description: "OpenTelemetry authentication key",
        envMapping: { api_key: "OTEL_API_KEY" }
      }
    ]
  },
  provider: new OTelProvider({
    enabled: true,
    provider: "otel",
    endpoint: process.env.OTEL_ENDPOINT,
    serviceName: "action-llama",
    headers: process.env.OTEL_API_KEY ? { "api-key": process.env.OTEL_API_KEY } : undefined
  }),
  async init(config) {
    // Extension initialization - the provider will be initialized by the registry
  },
  async shutdown() {
    await this.provider.shutdown();
  }
};