import { createHmac } from "crypto";
import type { WebhookProvider, WebhookContext, WebhookFilter } from "../types.js";
import type { TwitterWebhookFilter } from "../types.js";
import { truncateEventText as truncate, validateHmacSignature } from "../validation.js";

export class TwitterWebhookProvider implements WebhookProvider {
  source = "twitter";

  validateRequest(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secrets?: Record<string, string>,
    allowUnsigned?: boolean
  ): string | null {
    return validateHmacSignature(rawBody, headers["x-twitter-webhooks-signature"], secrets, "sha256=", allowUnsigned);
  }

  handleCrcChallenge(
    queryParams: Record<string, string>,
    secrets?: Record<string, string>
  ): { status: number; body: any } | null {
    const crcToken = queryParams["crc_token"];
    if (!crcToken) return null;

    if (!secrets || Object.keys(secrets).length === 0) return null;

    // Use the first available secret
    const secret = Object.values(secrets)[0];
    const hmac = createHmac("sha256", secret).update(crcToken).digest("base64");
    return {
      status: 200,
      body: { response_token: `sha256=${hmac}` },
    };
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    if (!body || typeof body !== "object") return null;

    const forUserId: string = body.for_user_id ?? "unknown";

    // Metadata keys that are not event arrays
    const metadataKeys = new Set(["for_user_id", "user_has_blocked"]);

    // Find the first event key in the payload
    let eventKey: string | null = null;
    for (const key of Object.keys(body)) {
      if (!metadataKeys.has(key) && Array.isArray(body[key])) {
        eventKey = key;
        break;
      }
    }

    if (!eventKey) return null;

    const events = body[eventKey];
    const firstEvent = Array.isArray(events) && events.length > 0 ? events[0] : null;

    // Derive action from event key (e.g. tweet_create_events -> create, favorite_events -> favorite)
    const withoutSuffix = eventKey.replace(/_events$/, "");
    const lastUnderscore = withoutSuffix.lastIndexOf("_");
    const action = lastUnderscore >= 0 ? withoutSuffix.slice(lastUnderscore + 1) : withoutSuffix;

    const base: Partial<WebhookContext> = {
      source: "twitter",
      event: eventKey,
      action,
      repo: forUserId,
      sender: "unknown",
      timestamp: new Date().toISOString(),
    };

    if (!firstEvent) {
      return base as WebhookContext;
    }

    return this.extractContext(eventKey, firstEvent, base);
  }

  private extractContext(
    eventKey: string,
    event: any,
    base: Partial<WebhookContext>
  ): WebhookContext {
    switch (eventKey) {
      case "tweet_create_events": {
        return {
          ...base,
          sender: event.user?.screen_name ?? event.user?.id_str ?? "unknown",
          title: truncate(event.text),
          body: truncate(event.text),
          url: event.user?.screen_name && event.id_str
            ? `https://twitter.com/${event.user.screen_name}/status/${event.id_str}`
            : undefined,
          timestamp: event.created_at ? new Date(event.created_at).toISOString() : base.timestamp!,
        } as WebhookContext;
      }

      case "tweet_delete_events": {
        return {
          ...base,
          sender: event.user_id ?? "unknown",
          title: `Deleted tweet ${event.status?.id ?? "unknown"}`,
          timestamp: event.timestamp_ms
            ? new Date(parseInt(event.timestamp_ms)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      case "favorite_events": {
        return {
          ...base,
          sender: event.user?.screen_name ?? event.user?.id_str ?? "unknown",
          title: `Liked tweet by @${event.favorited_status?.user?.screen_name ?? "unknown"}`,
          body: truncate(event.favorited_status?.text),
          url: event.favorited_status?.user?.screen_name && event.favorited_status?.id_str
            ? `https://twitter.com/${event.favorited_status.user.screen_name}/status/${event.favorited_status.id_str}`
            : undefined,
          timestamp: event.created_at ? new Date(event.created_at).toISOString() : base.timestamp!,
        } as WebhookContext;
      }

      case "follow_events": {
        return {
          ...base,
          sender: event.source?.screen_name ?? event.source?.id ?? "unknown",
          title: `@${event.source?.screen_name ?? "unknown"} followed @${event.target?.screen_name ?? "unknown"}`,
          timestamp: event.created_timestamp
            ? new Date(parseInt(event.created_timestamp)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      case "unfollow_events": {
        return {
          ...base,
          sender: event.source?.screen_name ?? event.source?.id ?? "unknown",
          title: `@${event.source?.screen_name ?? "unknown"} unfollowed @${event.target?.screen_name ?? "unknown"}`,
          timestamp: event.created_timestamp
            ? new Date(parseInt(event.created_timestamp)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      case "block_events":
      case "unblock_events": {
        const evtType = eventKey === "block_events" ? "blocked" : "unblocked";
        return {
          ...base,
          sender: event.source?.screen_name ?? event.source?.id ?? "unknown",
          title: `@${event.source?.screen_name ?? "unknown"} ${evtType} @${event.target?.screen_name ?? "unknown"}`,
          timestamp: event.created_timestamp
            ? new Date(parseInt(event.created_timestamp)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      case "mute_events":
      case "unmute_events": {
        const evtType = eventKey === "mute_events" ? "muted" : "unmuted";
        return {
          ...base,
          sender: event.source?.screen_name ?? event.source?.id ?? "unknown",
          title: `@${event.source?.screen_name ?? "unknown"} ${evtType} @${event.target?.screen_name ?? "unknown"}`,
          timestamp: event.created_timestamp
            ? new Date(parseInt(event.created_timestamp)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      case "direct_message_events": {
        const msgData = event.message_create?.message_data;
        const senderId = event.message_create?.sender_id ?? "unknown";
        return {
          ...base,
          sender: senderId,
          title: `Direct message from ${senderId}`,
          body: truncate(msgData?.text),
          timestamp: event.created_timestamp
            ? new Date(parseInt(event.created_timestamp)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      case "direct_message_indicate_typing_events": {
        return {
          ...base,
          sender: event.sender_id ?? "unknown",
          title: `Typing indicator from ${event.sender_id ?? "unknown"}`,
          timestamp: event.created_timestamp
            ? new Date(parseInt(event.created_timestamp)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      case "direct_message_mark_read_events": {
        return {
          ...base,
          sender: event.sender_id ?? "unknown",
          title: `Message read by ${event.sender_id ?? "unknown"}`,
          timestamp: event.created_timestamp
            ? new Date(parseInt(event.created_timestamp)).toISOString()
            : base.timestamp!,
        } as WebhookContext;
      }

      default:
        return {
          ...base,
          title: eventKey,
        } as WebhookContext;
    }
  }

  matchesFilter(context: WebhookContext, filter: WebhookFilter): boolean {
    const f = filter as TwitterWebhookFilter;

    if (f.events?.length && !f.events.includes(context.event)) {
      return false;
    }

    if (f.users?.length && !f.users.includes(context.repo)) {
      return false;
    }

    return true;
  }
}
