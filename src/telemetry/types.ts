import type { Tracer } from "@opentelemetry/api";

/**
 * Telemetry configuration interface
 */
export interface TelemetryConfig {
  /** Whether telemetry is enabled */
  enabled: boolean;
  /** Telemetry provider type */
  provider: "otel" | "xray" | "none";
  /** OTLP collector endpoint URL */
  endpoint?: string;
  /** Service name for traces */
  serviceName?: string;
  /** Headers to include in exports */
  headers?: Record<string, string>;
  /** Trace propagators to use */
  propagators?: string[];
  /** Sampling rate (0.0 to 1.0) */
  samplingRate?: number;
}

/**
 * Interface for telemetry providers
 */
export interface TelemetryProvider {
  /** Initialize the provider */
  init(): Promise<void>;
  /** Get the tracer instance */
  getTracer(): Tracer;
  /** Gracefully shutdown the provider */
  shutdown(): Promise<void>;
}

/**
 * Standard span attributes for Action Llama
 */
export interface SpanAttributes {
  /** Agent name */
  "agent.name"?: string;
  /** Run ID or instance ID */
  "agent.run_id"?: string;
  /** Trigger type: schedule, webhook, agent */
  "agent.trigger_type"?: string;
  /** Model provider */
  "agent.model_provider"?: string;
  /** Model name */
  "agent.model_name"?: string;
  /** Webhook event type */
  "webhook.event"?: string;
  /** Webhook source */
  "webhook.source"?: string;
  /** Execution environment */
  "execution.environment"?: string;
  /** Container runtime type */
  "runtime.type"?: string;
}

/**
 * Span result status
 */
export type SpanStatus = "success" | "error" | "timeout";