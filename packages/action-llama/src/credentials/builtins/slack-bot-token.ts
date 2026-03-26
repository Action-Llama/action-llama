import type { CredentialDefinition } from "../schema.js";

const slackBotToken: CredentialDefinition = {
  id: "slack_bot_token",
  label: "Slack Bot Token",
  description: "Slack bot user OAuth token for interacting with the Slack API",
  helpUrl: "https://api.slack.com/authentication/token-types#bot",
  fields: [
    { name: "token", label: "Bot Token", description: "Slack bot user OAuth token (xoxb-...)", secret: true },
  ],
  envVars: { token: "SLACK_BOT_TOKEN" },
  agentContext: "`SLACK_BOT_TOKEN` — use for Slack API access via curl or HTTP libraries",

  async validate(values) {
    if (!values.token) throw new Error("Slack bot token is required");
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${values.token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    if (!data.ok) throw new Error(`Invalid Slack bot token: ${data.error}`);
    return true;
  },
};

export default slackBotToken;
