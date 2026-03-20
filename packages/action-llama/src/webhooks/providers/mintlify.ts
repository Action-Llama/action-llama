import type { WebhookProvider, WebhookContext, WebhookFilter, MintlifyWebhookFilter } from "../types.js";
import { truncateEventText as truncate, validateHmacSignature } from "../validation.js";

export class MintlifyWebhookProvider implements WebhookProvider {
  source = "mintlify";

  validateRequest(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>
  ): string | null {
    // Look for Mintlify signature header - common variations
    const signature = headers["x-mintlify-signature"] || headers["mintlify-signature"];
    return validateHmacSignature(rawBody, signature, secrets);
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    // Handle potential missing or malformed payload
    if (!body || typeof body !== "object") return null;

    const event = body.event || "build";
    const action = body.action || body.status;
    
    if (!action) return null;

    const base: Partial<WebhookContext> = {
      source: "mintlify",
      event,
      action,
      repo: body.project || body.organization || "unknown",
      sender: body.user?.email || body.user?.name || "mintlify",
      timestamp: body.timestamp || new Date().toISOString(),
    };

    return this.extractContext(body, base);
  }

  private extractContext(
    body: any,
    base: Partial<WebhookContext>
  ): WebhookContext | null {
    // Extract build-specific information
    const context: WebhookContext = {
      ...base,
      title: body.title || `Build ${base.action}`,
      body: truncate(body.message || body.error || body.description),
      url: body.url || body.build_url || body.logs_url,
      branch: body.branch || body.git?.branch || "main",
    } as WebhookContext;

    // Add additional context for failed builds
    if (base.action === "failed" || base.action === "failure") {
      context.conclusion = "failure";
      if (body.error) {
        context.body = truncate(`Build failed: ${body.error}`);
      }
    } else if (base.action === "succeeded" || base.action === "success") {
      context.conclusion = "success";
    }

    return context;
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as MintlifyWebhookFilter;

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

    if (f.projects?.length && !f.projects.includes(context.repo)) {
      return false;
    }

    if (f.branches?.length && context.branch && !f.branches.includes(context.branch)) {
      return false;
    }

    return true;
  }
}