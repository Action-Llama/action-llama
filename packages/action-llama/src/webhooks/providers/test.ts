import type { WebhookProvider, WebhookContext, WebhookFilter } from "../types.js";

export interface TestWebhookFilter {
  events?: string[];
  actions?: string[];
  repos?: string[];
}

/**
 * Test webhook provider that skips HMAC signature validation.
 * Reads JSON body directly as WebhookContext fields.
 * Only activates when an agent config references type = "test".
 */
export class TestWebhookProvider implements WebhookProvider {
  source = "test";

  validateRequest(
    _headers: Record<string, string | undefined>,
    _rawBody: string,
    _secrets?: Record<string, string>
  ): string | null {
    // Always valid — no HMAC check for test webhooks
    return "test";
  }

  parseEvent(_headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    // Read JSON body directly as WebhookContext
    if (!body || typeof body !== "object") return null;

    return {
      source: body.source || "test",
      event: body.event || "test",
      action: body.action,
      repo: body.repo || "",
      number: body.number,
      title: body.title,
      body: body.body,
      url: body.url,
      author: body.author,
      assignee: body.assignee,
      labels: body.labels,
      branch: body.branch,
      comment: body.comment,
      sender: body.sender || "test",
      timestamp: body.timestamp || new Date().toISOString(),
    };
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as TestWebhookFilter;

    if (f.events?.length && !f.events.includes(context.event)) {
      return false;
    }

    if (f.actions?.length && context.action && !f.actions.includes(context.action)) {
      return false;
    }

    if (f.actions?.length && !context.action) {
      return false;
    }

    if (f.repos?.length && !f.repos.includes(context.repo)) {
      return false;
    }

    return true;
  }
}
