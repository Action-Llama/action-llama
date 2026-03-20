import type { WebhookProvider, WebhookContext, WebhookFilter, LinearWebhookFilter } from "../types.js";
import { truncateEventText as truncate, validateHmacSignature } from "../validation.js";

export class LinearWebhookProvider implements WebhookProvider {
  source = "linear";

  validateRequest(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>
  ): string | null {
    return validateHmacSignature(rawBody, headers["linear-signature"], secrets);
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    const action = body.action;
    const type = body.type;
    
    if (!action || !type) return null;

    // Map Linear event types to generic event types
    let event: string;
    switch (type) {
      case "Issue":
        event = "issues";
        break;
      case "Comment":
        event = "issue_comment";
        break;
      default:
        event = type.toLowerCase();
    }

    // Extract organization/workspace info from Linear payload
    const organization = body.organizationId || body.data?.team?.organization?.id;
    if (!organization) return null;

    const base: Partial<WebhookContext> = {
      source: "linear",
      event,
      action,
      repo: organization, // Use organization ID as repo equivalent
      sender: body.createdBy?.email || body.updatedBy?.email || "unknown",
      timestamp: new Date().toISOString(),
    };

    return this.extractContext(type, body, base);
  }

  private extractContext(
    type: string,
    body: any,
    base: Partial<WebhookContext>
  ): WebhookContext | null {
    const data = body.data;
    if (!data) return null;

    switch (type) {
      case "Issue": {
        return {
          ...base,
          number: data.number,
          title: data.title,
          body: truncate(data.description),
          url: data.url,
          author: data.creator?.email,
          assignee: data.assignee?.email,
          labels: data.labels?.map((l: any) => l.name) || [],
        } as WebhookContext;
      }

      case "Comment": {
        const issue = data.issue;
        if (!issue) return null;
        return {
          ...base,
          number: issue.number,
          title: issue.title,
          url: data.url || issue.url,
          author: issue.creator?.email,
          comment: truncate(data.body),
          labels: issue.labels?.map((l: any) => l.name) || [],
        } as WebhookContext;
      }

      default:
        // Return a generic context for unknown event types
        return {
          ...base,
          title: data.title || body.action || type,
          url: data.url,
        } as WebhookContext;
    }
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as LinearWebhookFilter;

    if (f.events?.length && !f.events.includes(context.event)) {
      return false;
    }

    if (f.actions?.length && context.action && !f.actions.includes(context.action)) {
      return false;
    }

    // If filter specifies actions but event has no action, skip
    if (f.actions?.length && !context.action) {
      return false;
    }

    if (f.organizations?.length && !f.organizations.includes(context.repo)) {
      return false;
    }

    if (f.labels?.length) {
      const contextLabels = context.labels || [];
      const hasMatchingLabel = f.labels.some((l) => contextLabels.includes(l));
      if (!hasMatchingLabel) return false;
    }

    if (f.assignee && context.assignee !== f.assignee) {
      return false;
    }

    if (f.author && context.author !== f.author) {
      return false;
    }

    return true;
  }
}