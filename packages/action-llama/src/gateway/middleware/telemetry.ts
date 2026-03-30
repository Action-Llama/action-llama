import type { Hono } from "hono";
import { withSpan, getTelemetry } from "../../telemetry/index.js";
import { SpanKind } from "@opentelemetry/api";

/**
 * Apply OpenTelemetry HTTP span middleware to the Hono app.
 * Wraps each request in a span with HTTP metadata.
 */
export function applyTelemetryMiddleware(app: Hono): void {
  const telemetry = getTelemetry();
  if (!telemetry) return;

  app.use("*", async (c, next) => {
    const spanName = `gateway.${c.req.method.toLowerCase()}_${c.req.path.replace(/\/+/g, "_").replace(/^_|_$/g, "") || "root"}`;

    await withSpan(
      spanName,
      async (span) => {
        span.setAttributes({
          "http.method": c.req.method,
          "http.url": c.req.url,
          "http.path": c.req.path,
          "http.user_agent": c.req.header("user-agent") || "",
          "gateway.component": "http_server",
        });

        await next();

        span.setAttributes({
          "http.status_code": c.res.status,
        });
      },
      {},
      SpanKind.SERVER
    );
  });
}
