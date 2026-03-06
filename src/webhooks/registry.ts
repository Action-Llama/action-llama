import type { WebhookProvider, WebhookBinding, WebhookContext, DispatchResult } from "./types.js";
import type { Logger } from "../shared/logger.js";

export class WebhookRegistry {
  private providers = new Map<string, WebhookProvider>();
  private bindings: WebhookBinding[] = [];
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  registerProvider(provider: WebhookProvider): void {
    this.providers.set(provider.source, provider);
    this.logger.info({ source: provider.source }, "webhook provider registered");
  }

  addBinding(binding: WebhookBinding): void {
    this.bindings.push(binding);
    this.logger.info(
      { agent: binding.agentName, type: binding.type, source: binding.source },
      "webhook binding added"
    );
  }

  getProvider(source: string): WebhookProvider | undefined {
    return this.providers.get(source);
  }

  dispatch(
    source: string,
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>
  ): DispatchResult {
    const provider = this.providers.get(source);
    if (!provider) {
      this.logger.warn({ source }, "dispatch: no provider for source");
      return { ok: false, matched: 0, skipped: 0, errors: [`unknown source: ${source}`] };
    }

    // Validate request signature — returns the matched instance name or null
    const matchedSource = provider.validateRequest(headers, rawBody, secrets);
    if (matchedSource === null) {
      this.logger.warn(
        { source, secretCount: secrets ? Object.keys(secrets).length : 0 },
        "webhook signature validation failed"
      );
      return { ok: false, matched: 0, skipped: 0, errors: ["signature validation failed"] };
    }

    // Parse the event — handle both JSON and form-encoded payloads
    let body: any;
    const contentType = headers["content-type"] || "";
    try {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(rawBody);
        const payload = params.get("payload");
        if (!payload) {
          this.logger.warn({ source }, "form-encoded webhook missing 'payload' field");
          return { ok: false, matched: 0, skipped: 0, errors: ["missing payload in form body"] };
        }
        body = JSON.parse(payload);
      } else {
        body = JSON.parse(rawBody);
      }
    } catch (err: any) {
      this.logger.warn({ source, contentType, err: err.message, bodyPreview: rawBody.slice(0, 200) }, "webhook body parse failed");
      return { ok: false, matched: 0, skipped: 0, errors: ["invalid JSON body"] };
    }

    const context = provider.parseEvent(headers, body);
    if (!context) {
      this.logger.warn(
        { source },
        "webhook event could not be parsed (parseEvent returned null)"
      );
      return { ok: true, matched: 0, skipped: 0, matchedSource };
    }

    this.logger.debug(
      { source, event: context.event, action: context.action, repo: context.repo, sender: context.sender, matchedSource },
      "webhook event parsed"
    );

    // Match against bindings and trigger
    let matched = 0;
    let skipped = 0;
    const bindingCount = this.bindings.filter(b => b.type === source).length;

    this.logger.debug({ source, matchedSource, bindingCount }, "checking webhook bindings");

    for (const binding of this.bindings) {
      // Binding must be for this provider type
      if (binding.type !== source) continue;
      // If binding specifies a source, it must match the validated credential instance
      if (binding.source && binding.source !== matchedSource) continue;

      const matches = binding.filter
        ? provider.matchesFilter(context, binding.filter)
        : true;
      this.logger.debug(
        { agent: binding.agentName, matches, source: binding.source, filter: binding.filter },
        "webhook binding check"
      );

      if (matches) {
        try {
          binding.trigger(context);
          matched++;
          this.logger.info(
            { agent: binding.agentName, event: context.event, action: context.action },
            "webhook triggered agent"
          );
        } catch (err: any) {
          skipped++;
          this.logger.error(
            { err, agent: binding.agentName },
            "webhook trigger callback failed"
          );
        }
      }
    }

    return { ok: true, matched, skipped, matchedSource };
  }
}
