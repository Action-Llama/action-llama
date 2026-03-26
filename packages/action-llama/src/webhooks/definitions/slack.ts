import type { WebhookDefinition } from "./schema.js";

export const slack: WebhookDefinition = {
  id: "slack",
  label: "Slack",
  description: "Slack Events API webhook events",
  secretCredential: "slack_signing_secret",
  filterSpec: [
    {
      field: "events",
      label: "Event Types",
      type: "multi-select",
      required: true,
      options: [
        { value: "message", label: "Messages" },
        { value: "app_mention", label: "App Mentions" },
        { value: "reaction_added", label: "Reaction Added" },
        { value: "reaction_removed", label: "Reaction Removed" },
        { value: "channel_created", label: "Channel Created" },
        { value: "member_joined_channel", label: "Member Joined Channel" },
      ],
    },
    { field: "channels", label: "Channels", type: "text[]" },
    { field: "team_ids", label: "Team/Workspace IDs", type: "text[]" },
  ],
};
