import { createHmac, timingSafeEqual } from "crypto";
import type { WebhookProvider, WebhookContext, WebhookFilter, SlackWebhookFilter } from "../types.js";
import { truncateEventText as truncate } from "../validation.js";

const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60; // 5 minutes

export class SlackWebhookProvider implements WebhookProvider {
  source = "slack";

  validateRequest(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>,
    allowUnsigned?: boolean
  ): string | null {
    // If no secrets configured, check allowUnsigned policy
    if (!secrets || Object.keys(secrets).length === 0) {
      return allowUnsigned ? "_unsigned" : null;
    }

    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];

    if (!timestamp || !signature) return null;

    // Replay protection: reject if timestamp is older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > MAX_TIMESTAMP_AGE_SECONDS) {
      return null;
    }

    const signingBase = `v0:${timestamp}:${rawBody}`;

    for (const [instanceName, secret] of Object.entries(secrets)) {
      const expected = "v0=" + createHmac("sha256", secret).update(signingBase).digest("hex");
      if (
        signature.length === expected.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      ) {
        return instanceName;
      }
    }

    return null;
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    // URL verification challenges are handled by handleChallenge, not dispatched
    if (body.type === "url_verification") {
      return null;
    }

    if (body.type !== "event_callback") {
      return null;
    }

    const event = body.event;
    if (!event) return null;

    const eventType: string = event.type;
    const teamId: string = body.team_id;
    const sender: string = event.user || event.bot_id || "unknown";

    const base: Partial<WebhookContext> = {
      source: "slack",
      event: eventType,
      repo: teamId,
      sender,
      timestamp: new Date().toISOString(),
    };

    switch (eventType) {
      case "message":
        return {
          ...base,
          body: truncate(event.text),
          comment: event.channel ? `channel:${event.channel}` : undefined,
        } as WebhookContext;

      case "app_mention":
        return {
          ...base,
          body: truncate(event.text),
          comment: event.channel ? `channel:${event.channel}` : undefined,
        } as WebhookContext;

      case "reaction_added":
      case "reaction_removed":
        return {
          ...base,
          title: event.reaction,
          comment: event.item ? `${event.item.type}:${event.item.channel || ""}` : undefined,
        } as WebhookContext;

      default:
        return {
          ...base,
          title: eventType,
          body: truncate(event.text),
        } as WebhookContext;
    }
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as SlackWebhookFilter;

    if (f.events?.length && !f.events.includes(context.event)) {
      return false;
    }

    if (f.team_ids?.length && !f.team_ids.includes(context.repo)) {
      return false;
    }

    // Channel matching: stored as comment field with "channel:<id>" format
    if (f.channels?.length) {
      const channelComment = context.comment;
      if (!channelComment) return false;
      const match = channelComment.match(/^channel:(.+)$/);
      if (!match) return false;
      const channelId = match[1];
      if (!f.channels.includes(channelId)) return false;
    }

    return true;
  }

  handleChallenge(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>,
    allowUnsigned?: boolean
  ): object | null {
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (body.type !== "url_verification" || !body.challenge) {
      return null;
    }

    // Validate the request signature before responding
    const validationResult = this.validateRequest(headers, rawBody, secrets, allowUnsigned);
    if (!validationResult) {
      return null;
    }

    return { challenge: body.challenge };
  }
}
