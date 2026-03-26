import type { CredentialDefinition } from "../schema.js";

const discordBot: CredentialDefinition = {
  id: "discord_bot",
  label: "Discord Bot Credentials",
  description:
    "Bot credentials from a Discord Application. Find these in the Discord Developer Portal under your application's General Information and Bot pages.",
  helpUrl: "https://discord.com/developers/applications",
  fields: [
    {
      name: "application_id",
      label: "Application ID",
      description: "From General Information page in the Discord Developer Portal",
      secret: false,
    },
    {
      name: "public_key",
      label: "Public Key",
      description: "From General Information page (used for webhook signature verification)",
      secret: false,
    },
    {
      name: "bot_token",
      label: "Bot Token",
      description: "From the Bot page (reset if you don't have it saved)",
      secret: true,
    },
  ],
  envVars: {
    application_id: "DISCORD_APPLICATION_ID",
    public_key: "DISCORD_PUBLIC_KEY",
    bot_token: "DISCORD_BOT_TOKEN",
  },
  agentContext:
    "`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` — use for Discord API access. Make REST calls to `https://discord.com/api/v10/` with header `Authorization: Bot $DISCORD_BOT_TOKEN`. Use slash commands via the Interactions Endpoint.",
};

export default discordBot;
