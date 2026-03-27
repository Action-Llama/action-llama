import type { WebhookDefinition } from "./schema.js";

export const twitter: WebhookDefinition = {
  id: "twitter",
  label: "X (Twitter)",
  description: "X (Twitter) Account Activity API webhook events",
  secretCredential: "x_twitter_api",
  filterSpec: [
    {
      field: "events",
      label: "Events",
      type: "multi-select",
      required: true,
      options: [
        { value: "tweet_create_events", label: "Tweet created" },
        { value: "tweet_delete_events", label: "Tweet deleted" },
        { value: "favorite_events", label: "Liked" },
        { value: "follow_events", label: "Followed" },
        { value: "unfollow_events", label: "Unfollowed" },
        { value: "block_events", label: "Blocked" },
        { value: "unblock_events", label: "Unblocked" },
        { value: "mute_events", label: "Muted" },
        { value: "unmute_events", label: "Unmuted" },
        { value: "direct_message_events", label: "Direct message" },
        { value: "direct_message_indicate_typing_events", label: "DM typing" },
        { value: "direct_message_mark_read_events", label: "DM read" },
      ],
    },
    { field: "users", label: "Subscribed user IDs", type: "text[]" },
  ],
};
