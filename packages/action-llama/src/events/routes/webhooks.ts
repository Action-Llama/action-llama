import { randomUUID } from "crypto";
import type { Hono } from "hono";
import type { WebhookRegistry } from "../../webhooks/registry.js";
import type { WebhookSourceConfig } from "../../shared/config.js";
import type { Logger } from "../../shared/logger.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { StatsStore } from "../../stats/store.js";

// Headers that contain secrets — strip before storing
const SIGNATURE_HEADERS = new Set([
  "x-hub-signature-256",
  "x-hub-signature",
  "sentry-hook-signature",
  "linear-signature",
  "mintlify-signature",
  "x-signature-ed25519",
  "x-signature-timestamp",
  "x-slack-signature",
  "x-slack-request-timestamp",
  "x-twitter-webhooks-signature",
]);

const MAX_STORED_BODY = 256 * 1024; // 256 KB

function stripSignatureHeaders(headers: Record<string, string | undefined>): string {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && !SIGNATURE_HEADERS.has(key)) {
      safe[key] = value;
    }
  }
  return JSON.stringify(safe);
}

export function registerWebhookRoutes(
  app: Hono,
  registry: WebhookRegistry,
  webhookSecrets: Record<string, Record<string, string>>,
  webhookConfigs: Record<string, WebhookSourceConfig>,
  logger: Logger,
  statusTracker?: StatusTracker,
  statsStore?: StatsStore,
): void {
  // GET route for CRC challenge-response (e.g. Twitter Account Activity API)
  app.get("/webhooks/:source", async (c) => {
    const source = c.req.param("source");
    const provider = registry.getProvider(source);
    if (!provider || !provider.handleCrcChallenge) {
      return c.json({ error: "CRC not supported for this source" }, 404);
    }

    const url = new URL(c.req.url);
    const queryParams: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      queryParams[key] = value;
    }

    const secrets = webhookSecrets[source];
    const result = provider.handleCrcChallenge(queryParams, secrets);
    if (!result) {
      logger.warn({ source }, "CRC challenge failed — missing crc_token or no secrets");
      return c.json({ error: "CRC challenge failed" }, 400);
    }

    logger.info({ source }, "CRC challenge-response completed");
    return c.json(result.body, result.status as any);
  });

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

    // Discord Interactions Endpoint: respond to PING verification (type: 1)
    if (source === "discord") {
      try {
        const parsedBody = JSON.parse(rawBody);
        if (parsedBody.type === 1) {
          // Validate signature before responding
          const discordSecrets = webhookSecrets[source];
          const discordConfig = webhookConfigs[source];
          const discordProvider = registry.getProvider("discord");
          if (discordProvider) {
            const sigResult = discordProvider.validateRequest(
              headers, rawBody, discordSecrets, discordConfig?.allowUnsigned
            );
            if (sigResult === null) {
              return c.json({ error: "signature validation failed" }, 401);
            }
          }
          logger.info({ source }, "Discord PING verified, responding with PONG");
          return c.json({ type: 1 });
        }
      } catch {
        // If JSON parsing fails, fall through to normal dispatch
      }
    }

    // Dedupe check: if provider supports delivery IDs, check for existing receipt
    if (statsStore && provider.getDeliveryId) {
      const deliveryId = provider.getDeliveryId(headers);
      if (deliveryId) {
        const existing = statsStore.findWebhookReceiptByDeliveryId(deliveryId);
        if (existing) {
          logger.info({ source, deliveryId }, "duplicate webhook delivery, skipping");
          return c.json({ ok: true, matched: 0, skipped: 0, duplicate: true });
        }
      }
    }

    // Generate receipt ID and determine delivery ID
    const receiptId = randomUUID();
    const deliveryId = provider.getDeliveryId?.(headers) ?? null;

    // Parse event summary from headers for the receipt
    const eventSummary = headers["x-github-event"]
      ? `${headers["x-github-event"]}${headers["x-github-event"] && headers["x-github-event"] !== "ping" ? "" : ""}`
      : source;

    // Record initial receipt (pending dispatch)
    if (statsStore) {
      try {
        const storedBody = rawBody.length > MAX_STORED_BODY
          ? rawBody.slice(0, MAX_STORED_BODY)
          : rawBody;
        statsStore.recordWebhookReceipt({
          id: receiptId,
          deliveryId: deliveryId ?? undefined,
          source,
          eventSummary,
          timestamp: Date.now(),
          headers: stripSignatureHeaders(headers),
          body: storedBody,
          matchedAgents: 0,
          status: "processed", // will update after dispatch
        });
      } catch (err) {
        logger.warn({ err, source }, "failed to record webhook receipt");
      }
    }

    const secrets = webhookSecrets[source];
    const config = webhookConfigs[source];

    // Handle provider setup challenges (e.g., Slack URL verification)
    if (provider.handleChallenge) {
      const challengeResponse = provider.handleChallenge(headers, rawBody, secrets, config?.allowUnsigned);
      if (challengeResponse) {
        logger.info({ source }, "webhook setup challenge handled");
        return c.json(challengeResponse);
      }
    }

    const result = registry.dispatch(source, headers, rawBody, { secrets, config }, receiptId);

    // Update receipt status based on dispatch result
    if (statsStore) {
      try {
        if (!result.ok) {
          const reason = result.errors?.includes("signature validation failed")
            ? "validation_failed" as const
            : result.errors?.includes("invalid JSON body")
              ? "parse_error" as const
              : "validation_failed" as const;
          statsStore.updateWebhookReceiptStatus(receiptId, 0, "dead-letter", reason);
        } else if (result.matched === 0) {
          statsStore.updateWebhookReceiptStatus(receiptId, 0, "dead-letter", "no_match");
        } else {
          statsStore.updateWebhookReceiptStatus(receiptId, result.matched, "processed");
        }
      } catch (err) {
        logger.warn({ err, source }, "failed to update webhook receipt status");
      }
    }

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

  // Replay endpoint: re-dispatch a stored webhook receipt
  if (statsStore) {
    app.post("/api/webhooks/:receiptId/replay", async (c) => {
      const receiptId = c.req.param("receiptId");
      const receipt = statsStore.getWebhookReceipt(receiptId);
      if (!receipt) {
        return c.json({ error: "receipt not found" }, 404);
      }
      if (!receipt.headers || !receipt.body) {
        return c.json({ error: "receipt has no stored payload" }, 400);
      }

      const storedHeaders: Record<string, string | undefined> = JSON.parse(receipt.headers);
      const secrets = webhookSecrets[receipt.source];
      const config = webhookConfigs[receipt.source];

      // Generate a new receipt for the replay
      const replayReceiptId = randomUUID();
      try {
        statsStore.recordWebhookReceipt({
          id: replayReceiptId,
          source: receipt.source,
          eventSummary: `replay:${receipt.eventSummary ?? receipt.source}`,
          timestamp: Date.now(),
          headers: receipt.headers,
          body: receipt.body,
          matchedAgents: 0,
          status: "processed",
        });
      } catch (err) {
        logger.warn({ err }, "failed to record replay receipt");
      }

      // Re-dispatch — skip signature validation for replays by passing allowUnsigned config
      const replayConfig = config ? { ...config, allowUnsigned: true } : { type: receipt.source, allowUnsigned: true };
      const result = registry.dispatch(receipt.source, storedHeaders, receipt.body, { secrets, config: replayConfig }, replayReceiptId);

      if (statsStore) {
        try {
          if (result.matched > 0) {
            statsStore.updateWebhookReceiptStatus(replayReceiptId, result.matched, "processed");
          } else {
            statsStore.updateWebhookReceiptStatus(replayReceiptId, 0, "dead-letter", "no_match");
          }
        } catch (err) {
          logger.warn({ err }, "failed to update replay receipt status");
        }
      }

      return c.json({
        ok: result.ok,
        matched: result.matched,
        skipped: result.skipped,
        replayReceiptId,
      });
    });
  }
}
