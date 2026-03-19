import type { Hono } from "hono";
import type { WebhookRegistry } from "../../webhooks/registry.js";
import type { Logger } from "../../shared/logger.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import { rateLimiter } from "../rate-limiter.js";

export function registerWebhookRoutes(
  app: Hono,
  registry: WebhookRegistry,
  webhookSecrets: Record<string, Record<string, string>>,
  logger: Logger,
  statusTracker?: StatusTracker
): void {
  // Rate limit webhook endpoint: 120 requests per minute per IP
  app.use("/webhooks/*", rateLimiter({ max: 120, windowMs: 60_000 }));

  app.post("/webhooks/:source", async (c) => {
    const source = c.req.param("source");
    logger.debug({ source }, "webhook request received");

    const provider = registry.getProvider(source);
    if (!provider) {
      logger.warn({ source }, "webhook rejected: unknown source");
      statusTracker?.addLogLine("webhook", `Rejected: unknown source "${source}"`);
      return c.json({ error: `unknown webhook source: ${source}` }, 404);
    }

    // Reject oversized payloads (10 MB limit)
    const MAX_BODY_SIZE = 10 * 1024 * 1024;
    const contentLength = parseInt(c.req.header("content-length") || "0", 10);
    if (contentLength > MAX_BODY_SIZE) {
      logger.warn({ source, contentLength }, "webhook rejected: payload too large");
      return c.json({ error: "payload too large" }, 413);
    }

    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch (err: any) {
      logger.error({ err, source }, "webhook body read failed");
      statusTracker?.addLogLine("webhook", `Failed to read body from ${source}: ${err.message}`);
      return c.json({ error: "failed to read request body" }, 400);
    }

    if (rawBody.length > MAX_BODY_SIZE) {
      logger.warn({ source, bodyLength: rawBody.length }, "webhook rejected: payload too large");
      return c.json({ error: "payload too large" }, 413);
    }

    logger.debug({ source, bodyLength: rawBody.length }, "webhook body read ok");

    // Extract headers as a flat map
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of c.req.raw.headers.entries()) {
      headers[key] = value;
    }

    logger.debug(
      {
        source,
        contentType: headers["content-type"],
        event: headers["x-github-event"],
        delivery: headers["x-github-delivery"],
        hasSignature: !!headers["x-hub-signature-256"],
      },
      "webhook headers"
    );

    const secrets = webhookSecrets[source];
    const result = registry.dispatch(source, headers, rawBody, secrets);

    if (!result.ok) {
      const status = result.errors?.includes("signature validation failed") ? 401 : 400;
      const errorMsg = result.errors?.[0] || "dispatch failed";
      logger.warn(
        { source, status, errors: result.errors },
        "webhook dispatch failed"
      );
      statusTracker?.addLogLine("webhook", `${source}: ${errorMsg}`);
      return c.json({ error: errorMsg }, status);
    }

    logger.info(
      { source, matched: result.matched, skipped: result.skipped },
      "webhook dispatched"
    );
    if (result.matched > 0) {
      statusTracker?.addLogLine("webhook", `${source}: dispatched to ${result.matched} agent${result.matched !== 1 ? "s" : ""}`);
    }
    return c.json({
      ok: true,
      matched: result.matched,
      skipped: result.skipped,
    });
  });
}
