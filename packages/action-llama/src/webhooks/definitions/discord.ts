import type { WebhookDefinition } from "./schema.js";

export const discord: WebhookDefinition = {
  id: "discord",
  label: "Discord",
  description: "Discord Interactions Endpoint webhook events",
  secretCredential: "discord_bot",
  filterSpec: [
    {
      field: "events",
      label: "Interaction Types",
      type: "multi-select",
      options: [
        { value: "application_command", label: "Slash Commands" },
        { value: "message_component", label: "Message Components" },
        { value: "modal_submit", label: "Modal Submissions" },
        { value: "autocomplete", label: "Autocomplete" },
      ],
    },
    { field: "guilds", label: "Guild IDs", type: "text[]" },
    { field: "channels", label: "Channel IDs", type: "text[]" },
    { field: "commands", label: "Command Names", type: "text[]" },
  ],
};
