import type { Router } from "../router.js";
import { readBody, sendJson, sendError } from "../router.js";
import type { WebhookRegistry } from "../../webhooks/registry.js";
import type { Logger } from "../../shared/logger.js";
import type { StatusTracker } from "../../tui/status-tracker.js";

export function registerWebhookRoutes(
  router: Router,
  registry: WebhookRegistry,
  webhookSecrets: Record<string, Record<string, string>>,
  logger: Logger,
  statusTracker?: StatusTracker
): void {
  router.post("/webhooks/:source", async (req, res, params) => {
    const source = params.source;
    logger.debug({ source }, "webhook request received");

    const provider = registry.getProvider(source);
    if (!provider) {
      logger.warn({ source }, "webhook rejected: unknown source");
      statusTracker?.addLogLine("webhook", `Rejected: unknown source "${source}"`);
      sendError(res, 404, `unknown webhook source: ${source}`);
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (err: any) {
      logger.error({ err, source }, "webhook body read failed");
      statusTracker?.addLogLine("webhook", `Failed to read body from ${source}: ${err.message}`);
      sendError(res, 400, "failed to read request body");
      return;
    }

    logger.debug({ source, bodyLength: rawBody.length }, "webhook body read ok");

    // Extract headers as a flat map
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value;
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
      sendError(res, status, errorMsg);
      return;
    }

    logger.info(
      { source, matched: result.matched, skipped: result.skipped },
      "webhook dispatched"
    );
    if (result.matched > 0) {
      statusTracker?.addLogLine("webhook", `${source}: dispatched to ${result.matched} agent${result.matched !== 1 ? "s" : ""}`);
    }
    sendJson(res, 200, {
      ok: true,
      matched: result.matched,
      skipped: result.skipped,
    });
  });
}
