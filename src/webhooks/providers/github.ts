import { createHmac, timingSafeEqual } from "crypto";
import type { WebhookProvider, WebhookContext, WebhookFilter, GitHubWebhookFilter } from "../types.js";

const MAX_TEXT_LENGTH = 4000;

function truncate(text: string | undefined | null, max = MAX_TEXT_LENGTH): string | undefined {
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) + "..." : text;
}

export class GitHubWebhookProvider implements WebhookProvider {
  source = "github";

  validateRequest(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret?: string
  ): boolean {
    // If no secret configured, skip validation (allow unsigned webhooks)
    if (!secret) return true;

    const signature = headers["x-hub-signature-256"];
    if (!signature) return false;

    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature.length !== expected.length) return false;

    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    const event = headers["x-github-event"];
    if (!event) return null;

    // Ping events (webhook setup verification)
    if (event === "ping") return null;

    const repo = body.repository?.full_name;
    if (!repo) return null;

    const base: Partial<WebhookContext> = {
      source: "github",
      event,
      action: body.action,
      repo,
      sender: body.sender?.login || "unknown",
      timestamp: new Date().toISOString(),
    };

    return this.extractContext(event, body, base);
  }

  private extractContext(
    event: string,
    body: any,
    base: Partial<WebhookContext>
  ): WebhookContext | null {
    switch (event) {
      case "issues": {
        const issue = body.issue;
        if (!issue) return null;
        return {
          ...base,
          number: issue.number,
          title: issue.title,
          body: truncate(issue.body),
          url: issue.html_url,
          author: issue.user?.login,
          assignee: issue.assignee?.login,
          labels: issue.labels?.map((l: any) => l.name) || [],
        } as WebhookContext;
      }

      case "pull_request": {
        const pr = body.pull_request;
        if (!pr) return null;
        return {
          ...base,
          number: pr.number,
          title: pr.title,
          body: truncate(pr.body),
          url: pr.html_url,
          author: pr.user?.login,
          assignee: pr.assignee?.login,
          labels: pr.labels?.map((l: any) => l.name) || [],
          branch: pr.head?.ref,
        } as WebhookContext;
      }

      case "issue_comment": {
        const issue = body.issue;
        const comment = body.comment;
        if (!issue || !comment) return null;
        return {
          ...base,
          number: issue.number,
          title: issue.title,
          url: comment.html_url,
          author: issue.user?.login,
          comment: truncate(comment.body),
          labels: issue.labels?.map((l: any) => l.name) || [],
        } as WebhookContext;
      }

      case "pull_request_review": {
        const pr = body.pull_request;
        const review = body.review;
        if (!pr || !review) return null;
        return {
          ...base,
          number: pr.number,
          title: pr.title,
          url: review.html_url,
          author: pr.user?.login,
          comment: truncate(review.body),
          branch: pr.head?.ref,
        } as WebhookContext;
      }

      case "push": {
        const ref = body.ref || "";
        const branch = ref.replace("refs/heads/", "");
        return {
          ...base,
          branch,
          url: body.compare,
          title: body.head_commit?.message,
          author: body.head_commit?.author?.username || body.pusher?.name,
        } as WebhookContext;
      }

      case "workflow_run": {
        const run = body.workflow_run;
        if (!run) return null;
        return {
          ...base,
          title: run.name,
          url: run.html_url,
          branch: run.head_branch,
          author: run.actor?.login,
        } as WebhookContext;
      }

      default:
        // Return a generic context for unknown event types
        return {
          ...base,
          title: body.action || event,
        } as WebhookContext;
    }
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as GitHubWebhookFilter;

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

    if (f.repos?.length && !f.repos.includes(context.repo)) {
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

    if (f.branches?.length && context.branch && !f.branches.includes(context.branch)) {
      return false;
    }

    return true;
  }
}
