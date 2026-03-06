import type { Router } from "../router.js";
import { readBody, sendJson, sendError } from "../router.js";
import type { WebhookRegistry } from "../../webhooks/registry.js";
import type { Logger } from "../../shared/logger.js";

export function registerWebhookRoutes(
  router: Router,
  registry: WebhookRegistry,
  webhookSecrets: Record<string, string[]>,
  logger: Logger
): void {
  router.post("/webhooks/:source", async (req, res, params) => {
    const source = params.source;
    logger.debug({ source }, "webhook request received");

    const provider = registry.getProvider(source);
    if (!provider) {
      logger.warn({ source }, "webhook rejected: unknown source");
      sendError(res, 404, `unknown webhook source: ${source}`);
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (err: any) {
      logger.error({ err, source }, "webhook body read failed");
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
      logger.warn(
        { source, status, errors: result.errors },
        "webhook dispatch failed"
      );
      sendError(res, status, result.errors?.[0] || "dispatch failed");
      return;
    }

    logger.info(
      { source, matched: result.matched, skipped: result.skipped },
      "webhook dispatched"
    );
    sendJson(res, 200, {
      ok: true,
      matched: result.matched,
      skipped: result.skipped,
    });
  });
}
