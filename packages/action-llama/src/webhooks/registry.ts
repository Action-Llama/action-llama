import type { WebhookProvider, WebhookBinding, WebhookContext, DispatchResult, DryRunResult, DryRunBindingResult } from "./types.js";
import type { WebhookSourceConfig } from "../shared/config.js";
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

  removeBindingsForAgent(agentName: string): number {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter(b => b.agentName !== agentName);
    return before - this.bindings.length;
  }

  dispatch(
    source: string,
    headers: Record<string, string | undefined>,
    rawBody: string,
    webhookConfig: { secrets?: Record<string, string>; config?: WebhookSourceConfig },
    receiptId?: string,
  ): DispatchResult {
    const provider = this.providers.get(source);
    if (!provider) {
      this.logger.warn({ source }, "dispatch: no provider for source");
      return { ok: false, matched: 0, skipped: 0, errors: [`unknown source: ${source}`] };
    }

    const { secrets } = webhookConfig;
    const allowUnsigned = webhookConfig.config?.allowUnsigned ?? false;

    // Validate request signature — returns the matched instance name or null
    const matchedSource = provider.validateRequest(headers, rawBody, secrets, allowUnsigned);
    if (matchedSource === null) {
      this.logger.warn(
        { source, secretCount: secrets ? Object.keys(secrets).length : 0, allowUnsigned },
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

    // Attach receiptId to context so downstream consumers can link runs to receipts
    if (receiptId) {
      context.receiptId = receiptId;
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
          const accepted = binding.trigger(context);
          if (accepted) {
            matched++;
            this.logger.info(
              { agent: binding.agentName, event: context.event, action: context.action },
              "webhook triggered agent"
            );
          } else {
            skipped++;
            this.logger.info(
              { agent: binding.agentName, event: context.event },
              "webhook matched but agent skipped (disabled or busy)"
            );
          }
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

  dryRunDispatch(
    source: string,
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>
  ): DryRunResult {
    const provider = this.providers.get(source);
    if (!provider) {
      return { 
        ok: false, 
        context: null,
        validationResult: null,
        parseError: `unknown source: ${source}`,
        bindings: [] 
      };
    }

    // Validate request signature — returns the matched instance name or null
    const matchedSource = provider.validateRequest(headers, rawBody, secrets);
    if (matchedSource === null) {
      return { 
        ok: false, 
        context: null,
        validationResult: "signature validation failed",
        bindings: [] 
      };
    }

    // Parse the event — handle both JSON and form-encoded payloads
    let body: any;
    const contentType = headers["content-type"] || "";
    try {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(rawBody);
        const payload = params.get("payload");
        if (!payload) {
          return { 
            ok: false, 
            context: null,
            validationResult: matchedSource,
            parseError: "missing payload in form body",
            bindings: [] 
          };
        }
        body = JSON.parse(payload);
      } else {
        body = JSON.parse(rawBody);
      }
    } catch (err: any) {
      return { 
        ok: false, 
        context: null,
        validationResult: matchedSource,
        parseError: `invalid JSON body: ${err.message}`,
        bindings: [] 
      };
    }

    const context = provider.parseEvent(headers, body);
    if (!context) {
      return { 
        ok: true, 
        context: null,
        validationResult: matchedSource,
        parseError: "webhook event could not be parsed (parseEvent returned null)",
        bindings: [] 
      };
    }

    // Check all bindings and collect detailed match information
    const bindings: DryRunBindingResult[] = [];

    for (const binding of this.bindings) {
      const result: DryRunBindingResult = {
        agentName: binding.agentName,
        matched: false,
        reasons: []
      };

      // Check if binding is for this provider type
      if (binding.type !== source) {
        result.reasons.push(`Type mismatch: binding expects '${binding.type}', webhook is '${source}'`);
        bindings.push(result);
        continue;
      }

      // Check if binding source matches the validated credential instance
      if (binding.source && binding.source !== matchedSource) {
        result.reasons.push(`Source mismatch: binding expects '${binding.source}', webhook matched '${matchedSource}'`);
        bindings.push(result);
        continue;
      }

      // Check filter match with detailed breakdown
      if (binding.filter) {
        const filterMatches = provider.matchesFilter(context, binding.filter);
        
        // Create detailed filter breakdown
        result.filterDetails = this.getFilterDetails(context, binding.filter, provider);
        
        if (!filterMatches) {
          result.reasons.push("Filter conditions not met");
          bindings.push(result);
          continue;
        }
      }

      // If we get here, the binding matches
      result.matched = true;
      result.reasons.push("All conditions satisfied");
      bindings.push(result);
    }

    return { 
      ok: true, 
      context,
      validationResult: matchedSource,
      bindings,
      matchedSource 
    };
  }

  private getFilterDetails(context: WebhookContext, filter: any, provider: WebhookProvider): any {
    const details: any = {
      type: true, // Provider type already matched at this point
      source: true // Source already matched at this point
    };

    // Check specific filter conditions based on the filter properties
    if ('events' in filter && filter.events) {
      details.event = filter.events.includes(context.event);
    }
    
    if ('actions' in filter && filter.actions) {
      details.action = context.action ? filter.actions.includes(context.action) : false;
    }
    
    if ('repos' in filter && filter.repos) {
      details.repo = filter.repos.includes(context.repo);
    }
    
    if ('org' in filter && filter.org) {
      details.org = context.repo.startsWith(`${filter.org}/`);
    }
    
    if ('orgs' in filter && filter.orgs) {
      details.org = filter.orgs.some((org: string) => context.repo.startsWith(`${org}/`));
    }
    
    if ('organizations' in filter && filter.organizations) {
      details.org = filter.organizations.some((org: string) => context.repo.startsWith(`${org}/`));
    }
    
    if ('labels' in filter && filter.labels && context.labels) {
      details.label = filter.labels.some((label: string) => context.labels?.includes(label));
    }
    
    if ('assignee' in filter && filter.assignee) {
      details.assignee = context.assignee === filter.assignee;
    }
    
    if ('author' in filter && filter.author) {
      details.author = context.author === filter.author;
    }
    
    if ('branches' in filter && filter.branches) {
      details.branch = context.branch ? filter.branches.includes(context.branch) : false;
    }
    
    if ('conclusions' in filter && filter.conclusions) {
      details.conclusion = context.conclusion ? filter.conclusions.includes(context.conclusion) : false;
    }
    
    if ('resources' in filter && filter.resources) {
      details.resource = filter.resources.some((resource: string) => 
        context.event?.includes(resource) || context.action?.includes(resource)
      );
    }

    return details;
  }
}
