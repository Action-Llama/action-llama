import type { WebhookProvider, WebhookContext, WebhookFilter, DiscordWebhookFilter } from "../types.js";
import { truncateEventText as truncate, validateEd25519Signature } from "../validation.js";

// Discord interaction types
const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const INTERACTION_TYPE_MESSAGE_COMPONENT = 3;
const INTERACTION_TYPE_AUTOCOMPLETE = 4;
const INTERACTION_TYPE_MODAL_SUBMIT = 5;

const INTERACTION_TYPE_NAMES: Record<number, string> = {
  [INTERACTION_TYPE_APPLICATION_COMMAND]: "application_command",
  [INTERACTION_TYPE_MESSAGE_COMPONENT]: "message_component",
  [INTERACTION_TYPE_AUTOCOMPLETE]: "autocomplete",
  [INTERACTION_TYPE_MODAL_SUBMIT]: "modal_submit",
};

export class DiscordWebhookProvider implements WebhookProvider {
  source = "discord";

  getDeliveryId(headers: Record<string, string | undefined>): string | null {
    return headers["x-interaction-id"] ?? null;
  }

  validateRequest(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>,
    allowUnsigned?: boolean
  ): string | null {
    return validateEd25519Signature(
      rawBody,
      headers["x-signature-timestamp"],
      headers["x-signature-ed25519"],
      secrets,
      allowUnsigned,
    );
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    if (!body || typeof body !== "object") return null;

    const interactionType = body.type;
    if (!interactionType || interactionType === INTERACTION_TYPE_PING) return null;

    const event = INTERACTION_TYPE_NAMES[interactionType];
    if (!event) return null;

    const data = body.data;
    const user = body.member?.user || body.user;
    const guildId = body.guild_id || "";
    const channelId = body.channel_id || "";

    const base: Partial<WebhookContext> = {
      source: "discord",
      event,
      repo: guildId,
      branch: channelId,
      sender: user?.username || "unknown",
      timestamp: new Date().toISOString(),
    };

    switch (interactionType) {
      case INTERACTION_TYPE_APPLICATION_COMMAND: {
        const commandName = data?.name || "unknown";
        const options = data?.options;
        let bodyText: string | undefined;
        if (options?.length) {
          bodyText = options.map((o: any) => `${o.name}: ${o.value}`).join(", ");
        }
        return {
          ...base,
          action: commandName,
          title: commandName,
          body: truncate(bodyText),
          number: undefined,
        } as WebhookContext;
      }

      case INTERACTION_TYPE_MESSAGE_COMPONENT: {
        return {
          ...base,
          action: String(data?.component_type || "unknown"),
          title: data?.custom_id || "component",
        } as WebhookContext;
      }

      case INTERACTION_TYPE_AUTOCOMPLETE: {
        const commandName = data?.name || "unknown";
        return {
          ...base,
          action: commandName,
          title: commandName,
        } as WebhookContext;
      }

      case INTERACTION_TYPE_MODAL_SUBMIT: {
        return {
          ...base,
          action: data?.custom_id || "modal",
          title: data?.custom_id || "modal",
        } as WebhookContext;
      }

      default:
        return {
          ...base,
          title: event,
        } as WebhookContext;
    }
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as DiscordWebhookFilter;

    if (f.events?.length && !f.events.includes(context.event)) {
      return false;
    }

    if (f.guilds?.length && !f.guilds.includes(context.repo)) {
      return false;
    }

    // channel_id is stored in context.branch
    if (f.channels?.length && context.branch && !f.channels.includes(context.branch)) {
      return false;
    }

    // commands filter: match against title (command name) for command-type events
    if (f.commands?.length) {
      if (context.event === "application_command" || context.event === "autocomplete") {
        if (!context.title || !f.commands.includes(context.title)) {
          return false;
        }
      }
      // For non-command events (components, modals), commands filter does not apply — pass through
    }

    return true;
  }
}
