import { trace, context, propagation, Span, SpanStatusCode, SpanKind } from "@opentelemetry/api";
import type { TelemetryConfig, TelemetryProvider, SpanAttributes, SpanStatus } from "./types.js";

/**
 * Telemetry manager that handles provider initialization and span management
 */
export class TelemetryManager {
  private provider?: TelemetryProvider;
  private tracer = trace.getTracer("noop");
  private config: TelemetryConfig;
  private initialized = false;

  constructor(config: TelemetryConfig) {
    this.config = config;
  }

  /**
   * Initialize telemetry based on configuration
   */
  async init(): Promise<void> {
    if (!this.config.enabled || this.config.provider === "none" || this.initialized) {
      return;
    }

    try {
      switch (this.config.provider) {
        case "otel": {
          const { OTelProvider } = await import("./providers/otel.js");
          this.provider = new OTelProvider(this.config);
          break;
        }
        case "xray": {
          const { XRayProvider } = await import("./providers/xray.js");
          this.provider = new XRayProvider(this.config);
          break;
        }
        default:
          console.warn(`Unknown telemetry provider: ${this.config.provider}`);
          return;
      }

      await this.provider.init();
      this.tracer = this.provider.getTracer();
      this.initialized = true;
    } catch (error) {
      console.warn("Failed to initialize telemetry:", error);
      // Continue without telemetry rather than failing the application
    }
  }

  /**
   * Create a new span with standard attributes
   */
  createSpan(name: string, attributes: SpanAttributes = {}, kind: SpanKind = SpanKind.INTERNAL): Span {
    if (!this.initialized) {
      return trace.getTracer("noop").startSpan(name);
    }

    try {
      return this.tracer.startSpan(name, {
        kind,
        attributes: {
          "service.name": this.config.serviceName || "action-llama",
          ...attributes,
        },
      });
    } catch (error) {
      console.warn("Failed to create span:", error);
      return trace.getTracer("noop").startSpan(name);
    }
  }

  /**
   * Execute a function within a span context
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes: SpanAttributes = {},
    kind: SpanKind = SpanKind.INTERNAL
  ): Promise<T> {
    const span = this.createSpan(name, attributes, kind);
    
    try {
      const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Set span status based on result
   */
  setSpanStatus(span: Span, status: SpanStatus, message?: string): void {
    try {
      switch (status) {
        case "success":
          span.setStatus({ code: SpanStatusCode.OK, message });
          break;
        case "error":
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          break;
        case "timeout":
          span.setStatus({ code: SpanStatusCode.ERROR, message: message || "Timeout" });
          span.setAttribute("error.timeout", true);
          break;
      }
    } catch (error) {
      console.warn("Failed to set span status:", error);
    }
  }

  /**
   * Get active trace context for propagation
   */
  getActiveContext(): string | undefined {
    try {
      if (!this.initialized) {
        return undefined;
      }

      const activeContext = context.active();
      const headers: Record<string, string> = {};
      propagation.inject(activeContext, headers);
      return headers["traceparent"];
    } catch (error) {
      console.warn("Failed to get active context:", error);
      return undefined;
    }
  }

  /**
   * Set trace context from parent
   */
  setTraceContext(traceParent: string): void {
    try {
      if (!this.initialized || !traceParent) {
        return;
      }

      const headers = { traceparent: traceParent };
      const parentContext = propagation.extract(context.active(), headers);
      context.with(parentContext, () => {
        // Context is now set for this execution
      });
    } catch (error) {
      console.warn("Failed to set trace context:", error);
    }
  }

  /**
   * Gracefully shutdown telemetry
   */
  async shutdown(): Promise<void> {
    if (this.provider) {
      try {
        await this.provider.shutdown();
      } catch (error) {
        console.warn("Error during telemetry shutdown:", error);
      }
    }
    this.initialized = false;
  }
}

// Global telemetry instance
let globalTelemetry: TelemetryManager | undefined;

/**
 * Initialize global telemetry instance
 */
export function initTelemetry(config: TelemetryConfig): TelemetryManager {
  globalTelemetry = new TelemetryManager(config);
  return globalTelemetry;
}

/**
 * Get the global telemetry instance
 */
export function getTelemetry(): TelemetryManager | undefined {
  return globalTelemetry;
}

/**
 * Convenience function to create a span
 */
export function createSpan(name: string, attributes: SpanAttributes = {}, kind: SpanKind = SpanKind.INTERNAL): Span {
  return globalTelemetry?.createSpan(name, attributes, kind) ?? trace.getTracer("noop").startSpan(name);
}

/**
 * Convenience function to execute code within a span
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: SpanAttributes = {},
  kind: SpanKind = SpanKind.INTERNAL
): Promise<T> {
  if (globalTelemetry) {
    return globalTelemetry.withSpan(name, fn, attributes, kind);
  }
  // Fallback without telemetry
  return fn(trace.getTracer("noop").startSpan(name));
}