import { createHmac, timingSafeEqual } from "crypto";
import type { WebhookProvider, WebhookContext, WebhookFilter, SentryWebhookFilter } from "../types.js";

const MAX_TEXT_LENGTH = 4000;

function truncate(text: string | undefined | null, max = MAX_TEXT_LENGTH): string | undefined {
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) + "..." : text;
}

export class SentryWebhookProvider implements WebhookProvider {
  source = "sentry";

  validateRequest(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret?: string
  ): boolean {
    // If no secret configured, skip validation
    if (!secret) return true;

    const signature = headers["sentry-hook-signature"];
    if (!signature) return false;

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature.length !== expected.length) return false;

    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    const resource = headers["sentry-hook-resource"];
    if (!resource) return null;

    const base: Partial<WebhookContext> = {
      source: "sentry",
      event: resource,
      action: body.action,
      sender: body.actor?.name || body.actor?.type || "unknown",
      timestamp: new Date().toISOString(),
    };

    return this.extractContext(resource, body, base);
  }

  private extractContext(
    resource: string,
    body: any,
    base: Partial<WebhookContext>
  ): WebhookContext {
    switch (resource) {
      case "event_alert": {
        const data = body.data || {};
        const event = data.event || {};
        return {
          ...base,
          repo: data.triggered_rule || "",
          title: truncate(event.title),
          url: event.web_url,
          body: truncate(event.message),
        } as WebhookContext;
      }

      case "metric_alert": {
        const data = body.data || {};
        const alert = data.metric_alert || {};
        return {
          ...base,
          repo: alert.organization?.slug || "",
          title: truncate(alert.title),
          url: alert.web_url,
        } as WebhookContext;
      }

      case "issue": {
        const data = body.data || {};
        const issue = data.issue || {};
        return {
          ...base,
          repo: issue.project?.slug || "",
          title: truncate(issue.title),
          url: issue.web_url,
          assignee: issue.assignedTo?.name,
        } as WebhookContext;
      }

      case "error": {
        const data = body.data || {};
        const error = data.error || {};
        return {
          ...base,
          repo: error.project?.slug || "",
          title: truncate(error.title),
          url: error.web_url,
          body: truncate(error.message),
        } as WebhookContext;
      }

      case "comment": {
        const data = body.data || {};
        const comment = data.comment || {};
        const issue = data.issue || {};
        return {
          ...base,
          repo: issue.project?.slug || "",
          title: truncate(issue.title),
          url: issue.web_url,
          comment: truncate(comment.text),
        } as WebhookContext;
      }

      default:
        return {
          ...base,
          repo: "",
          title: body.action || resource,
        } as WebhookContext;
    }
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as SentryWebhookFilter;

    if (f.resources?.length && !f.resources.includes(context.event)) {
      return false;
    }

    return true;
  }
}
